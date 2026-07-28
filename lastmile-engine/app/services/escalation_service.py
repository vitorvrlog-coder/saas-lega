"""
Resolução manual de ocorrências em ESCALATED_TO_HUMAN — o motor tem duas
etapas onde a IA (ou o cálculo de geo) pode escalar em vez de decidir
(app.state_machine.transitions.classification / reply), mas antes disso o
estado era terminal sem saída: uma vez escalada, a ocorrência ficava presa
pra sempre. Este módulo é o "operador no lugar da IA" nessas duas etapas,
sempre retomando o MESMO fluxo que a IA teria seguido dali (mesmas
mensagens, mesmos templates, mesma matriz de transições) — nunca um atalho
paralelo.

A etapa em que a ocorrência escalou é identificada por customer_phone: só é
preenchido na fila humana (app.services.human_queue_service), que só roda
DEPOIS da classificação (etapa 2). Se customer_phone é None, a escalação foi
na classificação; se já está preenchido, foi na resposta do cliente (etapa
5) ou no cálculo de raio (etapa 5b, que reusa a mesma etapa 5).
"""
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.enums import (
    AIDecisionType,
    FailureReason,
    MessageContentType,
    MessageDirection,
    MessageParticipant,
    OccurrenceState,
    TransitionActor,
)
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.geo.distance import haversine_km
from app.geo.geocoding import geocode_address
from app.schemas.ai_outputs import ReplyCategory
from app.services.message_templates import (
    DRIVER_DEFINITIVE_FAILURE,
    DRIVER_KEEP_AS_FAILURE_DENIED,
    DRIVER_NEW_INSTRUCTION_APPROVED,
    DRIVER_REFUSED_CLOSED,
    DRIVER_REPORT_RECEIVED_NOTICE,
    RADIUS_APPROVED_CUSTOMER,
    RADIUS_DENIED_CUSTOMER,
    render_template,
)
from app.services.occurrence_service import evolution_client_for, log_ai_decision, log_message
from app.state_machine.engine import transition


logger = logging.getLogger(__name__)


class InvalidEscalationStateError(Exception):
    pass


def _require_escalated(occurrence: Occurrence) -> None:
    if occurrence.state != OccurrenceState.ESCALATED_TO_HUMAN:
        raise InvalidEscalationStateError(
            f"Occurrence {occurrence.id} não está escalada (está em {occurrence.state.value})"
        )


async def resolve_classification_escalation(
    db: AsyncSession,
    settings: Settings,
    tenant: Tenant,
    occurrence: Occurrence,
    *,
    failure_reason: FailureReason,
) -> Occurrence:
    """Operador decide, no lugar da IA, o motivo do insucesso reportado pelo
    motorista (etapa 2). requires_customer_contact é derivado da mesma regra
    que o prompt da IA já usa: recusado nunca contata cliente."""
    _require_escalated(occurrence)
    if occurrence.customer_phone is not None:
        raise InvalidEscalationStateError(
            f"Occurrence {occurrence.id} já passou da etapa de classificação "
            "(customer_phone já preenchido) — use resolve_reply_escalation."
        )

    requires_customer_contact = failure_reason != FailureReason.REFUSED
    occurrence.failure_reason = failure_reason
    occurrence.requires_customer_contact = requires_customer_contact

    log_ai_decision(
        db, tenant.id, occurrence.id, AIDecisionType.FAILURE_CLASSIFICATION,
        ai_provider="human_operator", ai_model="n/a",
        input_payload={"resolved_by": "human_operator"},
        output_payload={
            "failure_reason": failure_reason.value,
            "requires_customer_contact": requires_customer_contact,
        },
        is_valid_schema=True, confidence=None, is_ambiguous=False, escalated_to_human=False,
    )

    next_state = (
        OccurrenceState.CLOSED_DEFINITIVE_FAILURE
        if failure_reason == FailureReason.REFUSED
        else OccurrenceState.PENDING_HUMAN_QUEUE
    )
    await transition(
        db, occurrence, next_state, TransitionActor.HUMAN_OPERATOR,
        reason="classificação resolvida manualmente pelo operador",
    )

    client = evolution_client_for(tenant, settings)

    if next_state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE:
        occurrence.closed_at = datetime.now(timezone.utc)
        occurrence.closure_reason = "Cliente recusou o recebimento (classificado manualmente)."

        driver_text = render_template(tenant, DRIVER_REFUSED_CLOSED)
    else:
        driver_text = render_template(
            tenant, DRIVER_REPORT_RECEIVED_NOTICE, failure_reason=failure_reason.value
        )

    if driver_text:
        await client.send_text(occurrence.driver_phone, driver_text)
        log_message(
            db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
            occurrence.driver_phone, MessageContentType.TEXT, driver_text,
        )

    return occurrence


async def resolve_reply_escalation(
    db: AsyncSession,
    settings: Settings,
    tenant: Tenant,
    occurrence: Occurrence,
    *,
    category: ReplyCategory,
    new_address_text: str | None = None,
    within_radius: bool | None = None,
) -> Occurrence:
    """Operador decide, no lugar da IA, o desfecho da resposta do cliente
    final (etapa 5). Para REQUESTS_NEW_ADDRESS, within_radius é sempre a
    decisão explícita do operador (não recalculada automaticamente) — é
    exatamente por isso que escalou: a IA ou o geocoder não conseguiram
    decidir sozinhos. Tenta geocodificar só pra enriquecer o registro
    (distance_km), nunca pra sobrepor a decisão do operador."""
    _require_escalated(occurrence)
    if occurrence.customer_phone is None:
        raise InvalidEscalationStateError(
            f"Occurrence {occurrence.id} ainda não passou da etapa de classificação "
            "(customer_phone não preenchido) — use resolve_classification_escalation."
        )

    if category == ReplyCategory.CONFIRMS_RESCHEDULE:
        next_state = OccurrenceState.CLOSED_RESOLVED
        closure_reason = "Cliente confirmou reagendamento (resolvido manualmente)."
        customer_text = None
        driver_text = render_template(tenant, DRIVER_NEW_INSTRUCTION_APPROVED, new_address="")

    elif category == ReplyCategory.DEFINITIVE_REFUSAL:
        next_state = OccurrenceState.CLOSED_DEFINITIVE_FAILURE
        closure_reason = "Cliente recusou definitivamente (resolvido manualmente)."
        customer_text = None
        driver_text = render_template(tenant, DRIVER_DEFINITIVE_FAILURE)

    elif category == ReplyCategory.REQUESTS_NEW_ADDRESS:
        if not new_address_text or within_radius is None:
            raise ValueError(
                "new_address_text e within_radius são obrigatórios para REQUESTS_NEW_ADDRESS."
            )

        occurrence.new_address_text = new_address_text
        occurrence.within_radius = within_radius

        distance_km = None
        try:
            if occurrence.original_address:
                origin = await geocode_address(occurrence.original_address, settings)
                destination = await geocode_address(new_address_text, settings)
                if origin and destination:
                    distance_km = round(haversine_km(origin.lat, origin.lon, destination.lat, destination.lon), 2)
                    occurrence.new_address_lat = destination.lat
                    occurrence.new_address_lon = destination.lon
        except Exception as exc:  # enriquecimento best-effort — nunca bloqueia a decisão do operador
            logger.warning("Falha ao geocodificar durante resolução manual de %s: %s", occurrence.id, exc)
        occurrence.distance_km = distance_km

        allowed_radius_km = float(tenant.allowed_radius_km)
        if within_radius:
            next_state = OccurrenceState.CLOSED_RESOLVED
            closure_reason = "Novo endereço aprovado manualmente pelo operador."
            customer_text = render_template(tenant, RADIUS_APPROVED_CUSTOMER, new_address=new_address_text)
            driver_text = render_template(tenant, DRIVER_NEW_INSTRUCTION_APPROVED, new_address=new_address_text)
        else:
            next_state = OccurrenceState.CLOSED_DEFINITIVE_FAILURE
            closure_reason = "Novo endereço negado manualmente pelo operador."
            customer_text = render_template(tenant, RADIUS_DENIED_CUSTOMER, allowed_radius_km=allowed_radius_km)
            driver_text = render_template(tenant, DRIVER_KEEP_AS_FAILURE_DENIED)

    else:
        raise ValueError(f"Categoria inválida para resolução manual: {category!r}")

    log_ai_decision(
        db, tenant.id, occurrence.id, AIDecisionType.REPLY_CLASSIFICATION,
        ai_provider="human_operator", ai_model="n/a",
        input_payload={"resolved_by": "human_operator"},
        output_payload={
            "category": category.value,
            "new_address_text": new_address_text,
            "within_radius": within_radius,
        },
        is_valid_schema=True, confidence=None, is_ambiguous=False, escalated_to_human=False,
    )

    await transition(
        db, occurrence, next_state, TransitionActor.HUMAN_OPERATOR,
        reason=f"resposta resolvida manualmente: {category.value}",
    )
    occurrence.closed_at = datetime.now(timezone.utc)
    occurrence.closure_reason = closure_reason

    client = evolution_client_for(tenant, settings)

    if customer_text:
        await client.send_text(occurrence.customer_phone, customer_text)
        log_message(
            db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.CUSTOMER,
            occurrence.customer_phone, MessageContentType.TEXT, customer_text,
        )
    if driver_text:
        await client.send_text(occurrence.driver_phone, driver_text)
        log_message(
            db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
            occurrence.driver_phone, MessageContentType.TEXT, driver_text,
        )

    return occurrence
