"""
Orquestra o fluxo de negócio ponta a ponta: recebe uma mensagem já
normalizada (app.integrations.evolution_api.webhook_parser) ou uma chamada
da API, chama IA/geo/evolution client conforme a etapa, e delega toda
mudança de estado para app.state_machine.engine.transition — nenhuma
função aqui muda occurrence.state diretamente.

A IA nunca repassa a resposta crua do cliente ao motorista: as mensagens
para o motorista sempre vêm de templates do tenant (app.services.
message_templates), parametrizados com dados já processados (endereço
aprovado, motivo, etc.), nunca com o texto literal do cliente.
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import run_structured
from app.ai.factory import get_ai_provider
from app.ai.prompts import failure_classification, reply_classification
from app.core.config import Settings
from app.db.models.ai_decision_log import AIDecisionLog
from app.db.models.enums import (
    AIDecisionType,
    MessageContentType,
    MessageDirection,
    MessageParticipant,
    OccurrenceState,
    TransitionActor,
)
from app.db.models.message_log import MessageLog
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.geo.distance import haversine_km
from app.geo.geocoding import GeocodingError, geocode_address
from app.integrations.evolution_api.client import EvolutionAPIError, EvolutionClient, extract_message_id
from app.integrations.evolution_api.phone import normalize_br_phone
from app.integrations.evolution_api.webhook_parser import ParsedInboundMessage
from app.schemas.ai_outputs import (
    FailureClassificationOutput,
    RadiusCheckOutput,
    ReplyCategory,
    ReplyClassificationOutput,
)
from app.services.driver_service import get_or_create_driver
from app.services.manifest_service import find_manifest_entry
from app.services.message_templates import (
    CONTACT_CUSTOMER_ATTEMPT_1,
    CONTACT_CUSTOMER_ATTEMPT_2,
    CUSTOMER_RESCHEDULE_CONFIRMED,
    DRIVER_CONTACTING_CUSTOMER_NOTICE,
    DRIVER_CUSTOMER_REPLIED_NOTICE,
    DRIVER_DEFINITIVE_FAILURE,
    DRIVER_FOLLOWUP_ACK,
    DRIVER_KEEP_AS_FAILURE_DENIED,
    DRIVER_NEW_INSTRUCTION_APPROVED,
    DRIVER_REFUSED_CLOSED,
    DRIVER_REPORT_ESCALATED_NOTICE,
    DRIVER_REPORT_RECEIVED_NOTICE,
    RADIUS_APPROVED_CUSTOMER,
    RADIUS_DENIED_CUSTOMER,
    render_template,
)
from app.state_machine.engine import transition
from app.state_machine.transitions.classification import decide_after_classification
from app.state_machine.transitions.radius import decide_after_radius_check
from app.state_machine.transitions.reply import decide_after_reply_classification
from app.state_machine.transitions.timeout import decide_after_timeout

logger = logging.getLogger(__name__)


def evolution_client_for(tenant: Tenant, settings: Settings) -> EvolutionClient:
    return EvolutionClient(
        base_url=settings.EVOLUTION_BASE_URL,
        instance=tenant.evolution_instance,
        token=tenant.evolution_token,
    )


def _as_raw_payload(send_result: dict | str) -> dict:
    """MessageLog.raw_payload guarda a resposta INTEIRA do /send/text —
    não só o ID — pra investigações futuras terem o payload completo
    (status, chave, timestamp do gateway) sem precisar reproduzir o envio."""
    return send_result if isinstance(send_result, dict) else {"raw_text_response": send_result}


async def _notify_driver_best_effort(
    db: AsyncSession, settings: Settings, tenant: Tenant, occurrence: Occurrence, text: str | None
) -> None:
    """Envia um aviso ao motorista sem deixar uma falha de envio derrubar o
    fluxo — sempre chamado a partir do webhook, que precisa responder 200
    (senão o gateway reenvia o evento). text=None (template não configurado)
    é no-op silencioso; o warning já saiu do render_template."""
    if not text:
        return
    try:
        client = evolution_client_for(tenant, settings)
        result = await client.send_text(occurrence.driver_phone, text)
        log_message(
            db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
            occurrence.driver_phone, MessageContentType.TEXT, text,
            external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
        )
    except EvolutionAPIError as exc:
        logger.warning(
            "Falha ao avisar motorista (occurrence %s): %s", occurrence.id, exc
        )


async def get_tenant_by_instance(db: AsyncSession, instance_name: str) -> Tenant | None:
    result = await db.execute(
        select(Tenant).where(Tenant.evolution_instance == instance_name, Tenant.is_active.is_(True))
    )
    return result.scalar_one_or_none()


async def find_occurrence_awaiting_customer_reply(
    db: AsyncSession, tenant_id: uuid.UUID, customer_phone: str
) -> Occurrence | None:
    result = await db.execute(
        select(Occurrence)
        .where(
            Occurrence.tenant_id == tenant_id,
            Occurrence.customer_phone == customer_phone,
            Occurrence.state.in_(
                [OccurrenceState.AWAITING_CUSTOMER_REPLY_1, OccurrenceState.AWAITING_CUSTOMER_REPLY_2]
            ),
        )
        .order_by(Occurrence.created_at.desc())
    )
    return result.scalars().first()


_TERMINAL_STATES = (OccurrenceState.CLOSED_RESOLVED, OccurrenceState.CLOSED_DEFINITIVE_FAILURE)


async def find_open_occurrence_for_driver(
    db: AsyncSession, tenant_id: uuid.UUID, driver_phone: str
) -> Occurrence | None:
    """Ocorrência ainda em andamento (não fechada) pra esse motorista —
    usado por handle_inbound_message pra distinguir um relato NOVO de
    insucesso de um comentário de acompanhamento ("ok", "tranquilo",
    "valeu") numa ocorrência que já está sendo tratada. Sem essa checagem,
    toda mensagem do motorista virava um relato do zero, reclassificado
    pela IA e reiniciando a cascata de avisos inteira — confirmado em
    produção: um motorista mandando 3-4 respostas casuais gerava 3-4
    ocorrências separadas em minutos, cada uma reenviando "Recebi seu
    relato!" e companhia."""
    result = await db.execute(
        select(Occurrence)
        .where(
            Occurrence.tenant_id == tenant_id,
            Occurrence.driver_phone == driver_phone,
            Occurrence.state.notin_(_TERMINAL_STATES),
        )
        .order_by(Occurrence.created_at.desc())
    )
    return result.scalars().first()


def log_message(
    db: AsyncSession,
    tenant_id,
    occurrence_id,
    direction: MessageDirection,
    participant: MessageParticipant,
    phone: str,
    content_type: MessageContentType,
    content_text: str | None,
    external_message_id: str | None = None,
    raw_payload: dict | None = None,
) -> MessageLog:
    # "sent" pra outbound = o gateway confirmou o POST (não garante entrega
    # real — só um evento de Receipt subsequente, via webhook, sobe isso
    # pra "delivered"/"read"; ver update_delivery_status). Sem
    # external_message_id (ex: template não configurado gerou envio sem
    # captura de resposta) não tem como correlacionar Receipt nenhum, então
    # fica sem status.
    delivery_status = "sent" if direction == MessageDirection.OUTBOUND and external_message_id else None
    log = MessageLog(
        tenant_id=tenant_id,
        occurrence_id=occurrence_id,
        direction=direction,
        participant=participant,
        phone=phone,
        content_type=content_type,
        content_text=content_text,
        external_message_id=external_message_id,
        raw_payload=raw_payload or {},
        delivery_status=delivery_status,
    )
    db.add(log)
    return log


_DELIVERY_STATUS_RANK = {"sent": 0, "delivered": 1, "played": 2, "read": 3}


async def update_delivery_status(
    db: AsyncSession, tenant_id: uuid.UUID, message_ids: list[str], status: str
) -> int:
    """Aplica um evento de Receipt (ver app.api.v1.webhooks) aos
    MessageLog outbound correspondentes — só anda pra frente na escala
    sent < delivered < played < read (um "sender" receipt tardio, por
    exemplo, não deve rebaixar uma mensagem já confirmada como lida)."""
    if status not in _DELIVERY_STATUS_RANK or not message_ids:
        return 0
    result = await db.execute(
        select(MessageLog).where(
            MessageLog.tenant_id == tenant_id,
            MessageLog.external_message_id.in_(message_ids),
            MessageLog.direction == MessageDirection.OUTBOUND,
        )
    )
    updated = 0
    for log in result.scalars().all():
        current_rank = _DELIVERY_STATUS_RANK.get(log.delivery_status or "sent", -1)
        if _DELIVERY_STATUS_RANK[status] > current_rank:
            log.delivery_status = status
            log.delivery_updated_at = datetime.now(timezone.utc)
            updated += 1
    return updated


def log_ai_decision(
    db: AsyncSession,
    tenant_id,
    occurrence_id,
    decision_type: AIDecisionType,
    ai_provider: str,
    ai_model: str,
    input_payload: dict,
    output_payload: dict | None,
    is_valid_schema: bool,
    confidence: float | None,
    is_ambiguous: bool,
    escalated_to_human: bool,
    error_message: str | None = None,
) -> AIDecisionLog:
    log = AIDecisionLog(
        tenant_id=tenant_id,
        occurrence_id=occurrence_id,
        decision_type=decision_type,
        ai_provider=ai_provider,
        ai_model=ai_model,
        input_payload=input_payload,
        output_payload=output_payload,
        is_valid_schema=is_valid_schema,
        confidence=confidence,
        is_ambiguous=is_ambiguous,
        escalated_to_human=escalated_to_human,
        error_message=error_message,
    )
    db.add(log)
    return log


async def handle_inbound_message(
    db: AsyncSession, settings: Settings, tenant: Tenant, message: ParsedInboundMessage
) -> Occurrence | None:
    """Ponto de entrada único chamado pelo endpoint de webhook (depois da
    checagem de idempotência). Decide se a mensagem é um novo relato de
    motorista, a resposta de um cliente a um contato em aberto, ou um
    comentário de acompanhamento do motorista numa ocorrência que ele
    mesmo já abriu e ainda está em andamento (ver find_open_occurrence_for_driver)."""
    existing_customer_wait = await find_occurrence_awaiting_customer_reply(db, tenant.id, message.phone)
    if existing_customer_wait is not None:
        return await handle_customer_reply(db, settings, tenant, existing_customer_wait, message)

    existing_driver_occurrence = await find_open_occurrence_for_driver(db, tenant.id, message.phone)
    if existing_driver_occurrence is not None:
        return await handle_driver_followup(db, settings, tenant, existing_driver_occurrence, message)

    return await handle_driver_report(db, settings, tenant, message)


async def handle_driver_followup(
    db: AsyncSession, settings: Settings, tenant: Tenant, occurrence: Occurrence, message: ParsedInboundMessage
) -> Occurrence:
    """Motorista comentando numa ocorrência que ele mesmo já abriu e que
    ainda está em andamento ("ok", "tranquilo", "valeu") — só registra no
    histórico, SEM reclassificar como relato novo nem reenviar a cascata
    de avisos (ver find_open_occurrence_for_driver pro bug que isso
    corrige). Aviso opcional e ÚNICO por ocorrência (driver_notice_acked)
    pra não parecer que a IA está ignorando o motorista, sem repetir o
    "Recebi seu relato!" pra cada mensagem casual."""
    log_message(
        db, tenant.id, occurrence.id, MessageDirection.INBOUND, MessageParticipant.DRIVER,
        message.phone, message.content_type, message.content_text,
        external_message_id=message.external_message_id, raw_payload=message.raw_payload,
    )

    if not occurrence.driver_followup_acked:
        ack_text = render_template(tenant, DRIVER_FOLLOWUP_ACK)
        if ack_text:
            try:
                client = evolution_client_for(tenant, settings)
                result = await client.send_text(occurrence.driver_phone, ack_text)
                log_message(
                    db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                    occurrence.driver_phone, MessageContentType.TEXT, ack_text,
                    external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
                )
            except EvolutionAPIError as exc:
                logger.warning(
                    "Falha ao confirmar recebimento de comentário do motorista (occurrence %s): %s",
                    occurrence.id, exc,
                )
        occurrence.driver_followup_acked = True

    return occurrence


async def handle_driver_report(
    db: AsyncSession, settings: Settings, tenant: Tenant, message: ParsedInboundMessage
) -> Occurrence:
    """Etapas 1-2 do fluxo: motorista reporta insucesso, IA classifica o
    motivo."""
    driver = await get_or_create_driver(db, tenant.id, message.phone)

    occurrence = Occurrence(tenant_id=tenant.id, driver_phone=message.phone, driver_id=driver.id)
    db.add(occurrence)
    await db.flush()

    log_message(
        db, tenant.id, occurrence.id, MessageDirection.INBOUND, MessageParticipant.DRIVER,
        message.phone, message.content_type, message.content_text,
        external_message_id=message.external_message_id, raw_payload=message.raw_payload,
    )

    await transition(
        db, occurrence, OccurrenceState.CLASSIFYING, TransitionActor.DRIVER,
        reason="motorista reportou insucesso",
    )

    if not message.content_text:
        log_ai_decision(
            db, tenant.id, occurrence.id, AIDecisionType.FAILURE_CLASSIFICATION,
            ai_provider="system", ai_model="n/a",
            input_payload={"content_type": message.content_type.value},
            output_payload=None, is_valid_schema=False, confidence=None,
            is_ambiguous=True, escalated_to_human=True,
            error_message="Mensagem sem texto classificável (áudio sem transcrição ou tipo desconhecido).",
        )
        await transition(
            db, occurrence, OccurrenceState.ESCALATED_TO_HUMAN, TransitionActor.SYSTEM,
            reason="sem conteúdo classificável",
        )
        # Sem isso o motorista mandava um áudio (ou tipo não suportado) e
        # ficava no vácuo — nada respondia. Avisa que o relato foi recebido
        # e vai pra análise humana.
        await _notify_driver_best_effort(
            db, settings, tenant, occurrence,
            render_template(tenant, DRIVER_REPORT_ESCALATED_NOTICE),
        )
        return occurrence

    provider = get_ai_provider(settings)
    result = await run_structured(
        provider,
        failure_classification.SYSTEM_PROMPT,
        failure_classification.build_user_prompt(message.content_text),
        FailureClassificationOutput,
    )

    decision = decide_after_classification(result.is_valid_schema, result.output)

    log_ai_decision(
        db, tenant.id, occurrence.id, AIDecisionType.FAILURE_CLASSIFICATION,
        ai_provider=result.provider, ai_model=result.model,
        input_payload={"driver_message": message.content_text},
        output_payload=result.raw_output, is_valid_schema=result.is_valid_schema,
        confidence=result.output.confidence if result.output else None,
        is_ambiguous=result.output.is_ambiguous if result.output else True,
        escalated_to_human=decision.escalated, error_message=result.error_message,
    )

    occurrence.failure_reason = decision.failure_reason
    occurrence.requires_customer_contact = decision.requires_customer_contact

    # Motorista não mandou telefone/endereço do cliente no relato, mas citou
    # um número de parada — busca na planilha de rota importada
    # (app.services.manifest_service) antes de cair na fila humana. Mesmo
    # efeito de fill_human_queue, só que automático. stop_number vem como
    # texto da IA (nunca inventado — ver ai_outputs.py); se não for um
    # número válido ou não achar na planilha, segue pro fluxo de hoje sem
    # erro nenhum.
    if decision.next_state == OccurrenceState.PENDING_HUMAN_QUEUE and result.output and result.output.stop_number:
        try:
            stop_number = int(str(result.output.stop_number).strip())
        except ValueError:
            stop_number = None

        if stop_number is not None:
            manifest_entry = await find_manifest_entry(db, tenant.id, message.phone, stop_number)
            # Só pula pra contato direto se a planilha realmente tinha os
            # dois campos que o motor precisa (telefone + endereço) — senão
            # segue pro fluxo de hoje (fila humana), igual a um match
            # incompleto na própria mensagem do motorista.
            if manifest_entry is not None and manifest_entry.customer_phone and manifest_entry.address:
                decision.next_state = OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1
                decision.customer_phone = manifest_entry.customer_phone
                decision.original_address = manifest_entry.address
                occurrence.route_id = manifest_entry.route_id
                occurrence.customer_name = manifest_entry.customer_name

    if decision.next_state == OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1:
        # Motorista já mandou telefone do cliente + endereço original junto
        # do relato — mesmos campos que a fila humana capturaria, só que
        # extraídos pela IA em vez de digitados por um operador.
        occurrence.customer_phone = normalize_br_phone(decision.customer_phone)
        occurrence.original_address = decision.original_address

    await transition(
        db, occurrence, decision.next_state, TransitionActor.AI,
        reason="classificação de motivo concluída",
    )

    if decision.next_state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE:
        occurrence.closed_at = datetime.now(timezone.utc)
        occurrence.closure_reason = "Cliente recusou o recebimento."

        driver_text = render_template(tenant, DRIVER_REFUSED_CLOSED)
        if driver_text:
            try:
                client = evolution_client_for(tenant, settings)
                result = await client.send_text(message.phone, driver_text)
                log_message(
                    db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                    message.phone, MessageContentType.TEXT, driver_text,
                    external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
                )
            except EvolutionAPIError as exc:
                # Best-effort: a ocorrência já fechou (transition acima) —
                # não deixa uma falha transitória de envio derrubar o
                # webhook (que precisa sempre responder 200, senão o
                # gateway reenvia o mesmo evento indefinidamente).
                logger.warning(
                    "Falha ao avisar motorista sobre recusa (occurrence %s): %s", occurrence.id, exc
                )
    elif decision.next_state == OccurrenceState.PENDING_HUMAN_QUEUE:
        # Confirmação imediata pro motorista — não pode esperar o operador
        # preencher a fila humana (pode levar minutos ou horas); o
        # motorista precisa saber na hora que o relato foi recebido.
        driver_text = render_template(
            tenant, DRIVER_REPORT_RECEIVED_NOTICE,
            failure_reason=occurrence.failure_reason.value if occurrence.failure_reason else "",
        )
        if driver_text:
            try:
                client = evolution_client_for(tenant, settings)
                result = await client.send_text(message.phone, driver_text)
                log_message(
                    db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                    message.phone, MessageContentType.TEXT, driver_text,
                    external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
                )
            except EvolutionAPIError as exc:
                # Best-effort: a ocorrência já está na fila humana (transition
                # acima) — não deixa a notificação também derrubar o webhook.
                logger.warning(
                    "Falha ao avisar motorista sobre fila humana (occurrence %s): %s", occurrence.id, exc
                )
    elif decision.next_state == OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1:
        # Já tem telefone + endereço — dispara o contato com o cliente na
        # hora, sem esperar a fila humana (send_contact_attempt já faz a
        # transição pra AWAITING_CUSTOMER_REPLY_1 sozinho).
        try:
            await send_contact_attempt(db, settings, tenant, occurrence, attempt_number=1)
        except EvolutionAPIError as exc:
            # Gateway/WhatsApp instável nesse momento (ex: erro transitório
            # de sessão recém-pareada) — não pode propagar: isso é chamado
            # a partir do webhook, que precisa sempre responder 200 (senão
            # o gateway reenvia o mesmo evento indefinidamente — confirmado
            # em produção). Em vez de perder o relato já classificado, cai
            # pra fila humana revisar manualmente, com telefone/endereço já
            # preenchidos pela IA.
            logger.warning(
                "Falha ao contatar cliente automaticamente (occurrence %s): %s", occurrence.id, exc
            )
            await transition(
                db, occurrence, OccurrenceState.PENDING_HUMAN_QUEUE, TransitionActor.SYSTEM,
                reason=f"falha ao contatar cliente automaticamente: {exc}",
            )
            driver_text = render_template(
                tenant, DRIVER_REPORT_RECEIVED_NOTICE,
                failure_reason=occurrence.failure_reason.value if occurrence.failure_reason else "",
            )
            if driver_text:
                try:
                    client = evolution_client_for(tenant, settings)
                    result = await client.send_text(message.phone, driver_text)
                    log_message(
                        db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                        message.phone, MessageContentType.TEXT, driver_text,
                        external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
                    )
                except EvolutionAPIError as notice_exc:
                    # Best-effort — a ocorrência já está a salvo na fila
                    # humana (transition acima); não deixa a notificação ao
                    # motorista também derrubar o webhook.
                    logger.warning(
                        "Falha ao avisar motorista sobre fallback pra fila humana (occurrence %s): %s",
                        occurrence.id, notice_exc,
                    )
    elif decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN:
        # IA não conseguiu classificar com segurança (ambíguo, baixa
        # confiança ou JSON inválido) — antes disso o motorista ficava sem
        # nenhuma resposta. Avisa que o relato foi recebido e vai pra
        # análise humana.
        await _notify_driver_best_effort(
            db, settings, tenant, occurrence,
            render_template(tenant, DRIVER_REPORT_ESCALATED_NOTICE),
        )

    return occurrence


async def send_contact_attempt(
    db: AsyncSession, settings: Settings, tenant: Tenant, occurrence: Occurrence, attempt_number: int
) -> Occurrence:
    """Etapa 4/6 do fluxo: envia a mensagem de contato ao cliente final
    (tentativa 1 ou 2) e move a ocorrência para o estado de espera."""
    if attempt_number == 1:
        expected_state = OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1
        next_state = OccurrenceState.AWAITING_CUSTOMER_REPLY_1
        template_key = CONTACT_CUSTOMER_ATTEMPT_1
    elif attempt_number == 2:
        expected_state = OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2
        next_state = OccurrenceState.AWAITING_CUSTOMER_REPLY_2
        template_key = CONTACT_CUSTOMER_ATTEMPT_2
    else:
        raise ValueError(f"attempt_number inválido: {attempt_number}")

    if occurrence.state != expected_state:
        raise ValueError(
            f"Occurrence {occurrence.id} não está em {expected_state.value} "
            f"(está em {occurrence.state.value})"
        )

    text = render_template(
        tenant, template_key,
        failure_reason=occurrence.failure_reason.value if occurrence.failure_reason else "",
        original_address=occurrence.original_address or "",
    )

    if text and occurrence.customer_phone:
        client = evolution_client_for(tenant, settings)
        result, resolved_phone = await client.send_text_resolved(occurrence.customer_phone, text)
        if resolved_phone and resolved_phone != occurrence.customer_phone:
            # O telefone digitado na fila humana pode não bater com o
            # formato que o WhatsApp usa internamente (confirmado em teste
            # real: DDDs onde o celular fica cadastrado sem o nono dígito).
            # Sem essa correção, a resposta do cliente chega com o telefone
            # resolvido e nunca correlaciona com esta ocorrência.
            logger.info(
                "Telefone do cliente corrigido de %s para %s (occurrence %s) — resolvido pelo WhatsApp no envio.",
                occurrence.customer_phone, resolved_phone, occurrence.id,
            )
            occurrence.customer_phone = resolved_phone
        log_message(
            db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.CUSTOMER,
            occurrence.customer_phone, MessageContentType.TEXT, text,
            external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
        )

    if attempt_number == 1:
        # Motorista reportou e não teve nenhum retorno até aqui — avisa
        # que o cliente está sendo contatado, para não ficar no vácuo
        # esperando o fechamento da ocorrência.
        driver_notice = render_template(
            tenant, DRIVER_CONTACTING_CUSTOMER_NOTICE,
            failure_reason=occurrence.failure_reason.value if occurrence.failure_reason else "",
        )
        if driver_notice:
            client = evolution_client_for(tenant, settings)
            result = await client.send_text(occurrence.driver_phone, driver_notice)
            log_message(
                db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                occurrence.driver_phone, MessageContentType.TEXT, driver_notice,
                external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
            )

    occurrence.contact_attempt_count += 1
    occurrence.last_contact_at = datetime.now(timezone.utc)

    await transition(
        db, occurrence, next_state, TransitionActor.AI,
        reason=f"tentativa de contato {attempt_number} enviada",
    )
    return occurrence


async def handle_customer_reply(
    db: AsyncSession, settings: Settings, tenant: Tenant, occurrence: Occurrence, message: ParsedInboundMessage
) -> Occurrence:
    """Etapa 5 do fluxo: IA classifica a resposta do cliente e decide o
    desfecho (reagendamento, novo endereço, recusa definitiva ou escalar)."""
    log_message(
        db, tenant.id, occurrence.id, MessageDirection.INBOUND, MessageParticipant.CUSTOMER,
        message.phone, message.content_type, message.content_text,
        external_message_id=message.external_message_id, raw_payload=message.raw_payload,
    )

    await transition(
        db, occurrence, OccurrenceState.PROCESSING_REPLY, TransitionActor.CUSTOMER,
        reason="cliente respondeu",
    )

    # Avisa o motorista assim que o cliente responde, independente do
    # desfecho que a IA vai decidir a seguir — sem isso, o motorista só
    # sabe de algo quando a ocorrência já fecha (ou nunca, se escalar).
    driver_notice = render_template(tenant, DRIVER_CUSTOMER_REPLIED_NOTICE)
    if driver_notice:
        try:
            client = evolution_client_for(tenant, settings)
            result = await client.send_text(occurrence.driver_phone, driver_notice)
            log_message(
                db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                occurrence.driver_phone, MessageContentType.TEXT, driver_notice,
                external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
            )
        except EvolutionAPIError as exc:
            # Best-effort — chamado a partir do webhook, que precisa sempre
            # responder 200 (senão o gateway reenvia o mesmo evento
            # indefinidamente). O resto do processamento da resposta segue.
            logger.warning(
                "Falha ao avisar motorista que cliente respondeu (occurrence %s): %s", occurrence.id, exc
            )

    if not message.content_text:
        log_ai_decision(
            db, tenant.id, occurrence.id, AIDecisionType.REPLY_CLASSIFICATION,
            ai_provider="system", ai_model="n/a",
            input_payload={"content_type": message.content_type.value},
            output_payload=None, is_valid_schema=False, confidence=None,
            is_ambiguous=True, escalated_to_human=True,
            error_message="Resposta sem texto classificável.",
        )
        await transition(
            db, occurrence, OccurrenceState.ESCALATED_TO_HUMAN, TransitionActor.SYSTEM,
            reason="sem conteúdo classificável",
        )
        return occurrence

    provider = get_ai_provider(settings)
    result = await run_structured(
        provider,
        reply_classification.SYSTEM_PROMPT,
        reply_classification.build_user_prompt(message.content_text),
        ReplyClassificationOutput,
    )

    reply_decision = decide_after_reply_classification(
        result.is_valid_schema, result.output, message.content_text
    )

    log_ai_decision(
        db, tenant.id, occurrence.id, AIDecisionType.REPLY_CLASSIFICATION,
        ai_provider=result.provider, ai_model=result.model,
        input_payload={"customer_message": message.content_text},
        output_payload=result.raw_output, is_valid_schema=result.is_valid_schema,
        confidence=result.output.confidence if result.output else None,
        is_ambiguous=result.output.is_ambiguous if result.output else True,
        escalated_to_human=reply_decision.escalated, error_message=result.error_message,
    )

    if reply_decision.escalated:
        await transition(
            db, occurrence, OccurrenceState.ESCALATED_TO_HUMAN, TransitionActor.AI,
            reason="resposta ambígua ou de baixa confiança",
        )
        return occurrence

    if reply_decision.requires_radius_check:
        await _handle_new_address_request(db, settings, tenant, occurrence, reply_decision)
        return occurrence

    # confirms_reschedule ou definitive_refusal — desfecho direto, sem geo.
    await transition(
        db, occurrence, reply_decision.next_state, TransitionActor.AI,
        reason=f"resposta classificada: {reply_decision.category.value}",
    )

    occurrence.closed_at = datetime.now(timezone.utc)
    occurrence.closure_reason = (
        "Cliente confirmou reagendamento."
        if reply_decision.category == ReplyCategory.CONFIRMS_RESCHEDULE
        else "Cliente recusou definitivamente."
    )

    if reply_decision.category == ReplyCategory.CONFIRMS_RESCHEDULE and occurrence.customer_phone:
        # Cliente só disse "estarei em casa em X minutos" (sem endereço
        # novo, por isso não passa por _handle_new_address_request/
        # RADIUS_APPROVED_CUSTOMER) — sem esse aviso, ele nunca sabia que
        # a confirmação de fato chegou até o motorista.
        customer_text = render_template(
            tenant, CUSTOMER_RESCHEDULE_CONFIRMED, customer_message=message.content_text or "",
        )
        if customer_text:
            try:
                client = evolution_client_for(tenant, settings)
                result = await client.send_text(occurrence.customer_phone, customer_text)
                log_message(
                    db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.CUSTOMER,
                    occurrence.customer_phone, MessageContentType.TEXT, customer_text,
                    external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
                )
            except EvolutionAPIError as exc:
                logger.warning(
                    "Falha ao avisar cliente sobre reagendamento confirmado (occurrence %s): %s",
                    occurrence.id, exc,
                )

    driver_text = render_template(
        tenant,
        DRIVER_NEW_INSTRUCTION_APPROVED
        if reply_decision.category == ReplyCategory.CONFIRMS_RESCHEDULE
        else DRIVER_DEFINITIVE_FAILURE,
        # Reagendamento confirmado sem endereço novo (sem passar por
        # _handle_new_address_request) — "" pra não estourar KeyError caso
        # o template do tenant referencie {new_address} (mesma chave usada
        # no outro fluxo, abaixo).
        new_address="",
    )
    if driver_text:
        try:
            client = evolution_client_for(tenant, settings)
            result = await client.send_text(occurrence.driver_phone, driver_text)
            log_message(
                db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                occurrence.driver_phone, MessageContentType.TEXT, driver_text,
                external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
            )
        except EvolutionAPIError as exc:
            # Best-effort — a ocorrência já fechou (transition acima), não
            # deixa a notificação também derrubar o webhook.
            logger.warning(
                "Falha ao avisar motorista sobre desfecho (occurrence %s): %s", occurrence.id, exc
            )

    return occurrence


async def _escalate_radius_check(
    db: AsyncSession, tenant: Tenant, occurrence: Occurrence, input_payload: dict, error_message: str
) -> None:
    log_ai_decision(
        db, tenant.id, occurrence.id, AIDecisionType.RADIUS_CHECK,
        ai_provider="system", ai_model="haversine",
        input_payload=input_payload, output_payload=None, is_valid_schema=False,
        confidence=None, is_ambiguous=True, escalated_to_human=True, error_message=error_message,
    )
    await transition(
        db, occurrence, OccurrenceState.ESCALATED_TO_HUMAN, TransitionActor.SYSTEM,
        reason=error_message,
    )


async def _handle_new_address_request(
    db: AsyncSession, settings: Settings, tenant: Tenant, occurrence: Occurrence, reply_decision
) -> None:
    occurrence.new_address_text = reply_decision.new_address_text
    base_payload = {
        "original_address": occurrence.original_address,
        "new_address_text": reply_decision.new_address_text,
    }

    if not occurrence.original_address:
        await _escalate_radius_check(
            db, tenant, occurrence, base_payload,
            "Occurrence sem endereço original — impossível calcular raio.",
        )
        return

    try:
        origin = await geocode_address(occurrence.original_address, settings)
        destination = await geocode_address(reply_decision.new_address_text, settings)
    except GeocodingError as exc:
        await _escalate_radius_check(db, tenant, occurrence, base_payload, f"Falha ao geocodificar: {exc}")
        return

    if origin is None or destination is None:
        await _escalate_radius_check(
            db, tenant, occurrence, base_payload, "Endereço não encontrado pelo geocoder."
        )
        return

    distance_km = round(haversine_km(origin.lat, origin.lon, destination.lat, destination.lon), 2)
    allowed_radius_km = float(tenant.allowed_radius_km)
    within_radius = distance_km <= allowed_radius_km

    radius_output = RadiusCheckOutput(
        within_radius=within_radius, distance_km=distance_km, allowed_radius_km=allowed_radius_km
    )
    log_ai_decision(
        db, tenant.id, occurrence.id, AIDecisionType.RADIUS_CHECK,
        ai_provider="system", ai_model="haversine",
        input_payload={
            **base_payload,
            "origin": {"lat": origin.lat, "lon": origin.lon},
            "destination": {"lat": destination.lat, "lon": destination.lon},
        },
        output_payload=radius_output.model_dump(), is_valid_schema=True,
        confidence=None, is_ambiguous=False, escalated_to_human=False,
    )

    occurrence.new_address_lat = destination.lat
    occurrence.new_address_lon = destination.lon
    occurrence.distance_km = distance_km
    occurrence.within_radius = within_radius

    next_state = decide_after_radius_check(within_radius)
    await transition(
        db, occurrence, next_state, TransitionActor.SYSTEM,
        reason=f"raio: {distance_km}km (permitido {allowed_radius_km}km)",
    )

    occurrence.closed_at = datetime.now(timezone.utc)
    occurrence.closure_reason = (
        "Novo endereço aprovado (dentro do raio permitido)."
        if within_radius
        else "Novo endereço fora do raio permitido — mantido como insucesso."
    )

    client = evolution_client_for(tenant, settings)

    if within_radius:
        customer_text = render_template(
            tenant, RADIUS_APPROVED_CUSTOMER, new_address=reply_decision.new_address_text
        )
        driver_text = render_template(
            tenant, DRIVER_NEW_INSTRUCTION_APPROVED, new_address=reply_decision.new_address_text
        )
    else:
        customer_text = render_template(tenant, RADIUS_DENIED_CUSTOMER, allowed_radius_km=allowed_radius_km)
        driver_text = render_template(tenant, DRIVER_KEEP_AS_FAILURE_DENIED)

    if customer_text:
        try:
            result = await client.send_text(occurrence.customer_phone, customer_text)
            log_message(
                db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.CUSTOMER,
                occurrence.customer_phone, MessageContentType.TEXT, customer_text,
                external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
            )
        except EvolutionAPIError as exc:
            # Best-effort — a ocorrência já fechou (transition acima), não
            # deixa a notificação também derrubar o webhook.
            logger.warning(
                "Falha ao avisar cliente sobre desfecho do raio (occurrence %s): %s", occurrence.id, exc
            )
    if driver_text:
        try:
            result = await client.send_text(occurrence.driver_phone, driver_text)
            log_message(
                db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
                occurrence.driver_phone, MessageContentType.TEXT, driver_text,
                external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
            )
        except EvolutionAPIError as exc:
            logger.warning(
                "Falha ao avisar motorista sobre desfecho do raio (occurrence %s): %s", occurrence.id, exc
            )


async def handle_contact_timeout(
    db: AsyncSession, settings: Settings, tenant: Tenant, occurrence: Occurrence
) -> Occurrence:
    """Etapa 6 do fluxo: cliente não respondeu dentro do timeout do tenant
    (chamado pelo worker de timeout, app.workers.timeout_checker)."""
    next_state = decide_after_timeout(occurrence.contact_attempt_count)

    if next_state == OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2:
        await transition(
            db, occurrence, next_state, TransitionActor.SYSTEM, reason="timeout tentativa 1"
        )
        await send_contact_attempt(db, settings, tenant, occurrence, attempt_number=2)
        return occurrence

    await transition(
        db, occurrence, next_state, TransitionActor.SYSTEM, reason="timeout tentativa 2, sem resposta"
    )
    occurrence.closed_at = datetime.now(timezone.utc)
    occurrence.closure_reason = "Sem resposta do cliente após 2 tentativas."

    driver_text = render_template(tenant, DRIVER_DEFINITIVE_FAILURE)
    if driver_text:
        client = evolution_client_for(tenant, settings)
        result = await client.send_text(occurrence.driver_phone, driver_text)
        log_message(
            db, tenant.id, occurrence.id, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
            occurrence.driver_phone, MessageContentType.TEXT, driver_text,
            external_message_id=extract_message_id(result), raw_payload=_as_raw_payload(result),
        )
    return occurrence


async def archive_occurrence(db: AsyncSession, occurrence: Occurrence) -> Occurrence:
    """Puramente visual — some do histórico padrão (app.web.routes), nunca
    mexe em occurrence.state nem passa pelo motor de transições."""
    occurrence.archived_at = datetime.now(timezone.utc)
    await db.flush()
    return occurrence


async def unarchive_occurrence(db: AsyncSession, occurrence: Occurrence) -> Occurrence:
    occurrence.archived_at = None
    await db.flush()
    return occurrence


async def delete_occurrence_history(db: AsyncSession, occurrence: Occurrence) -> None:
    """Exclusão definitiva (diferente de archive_occurrence, que só esconde
    do histórico padrão) — apaga também message_logs, já que
    message_logs.occurrence_id é ON DELETE SET NULL (deixaria mensagens
    órfãs, sem tenant identificável pela ocorrência, se não apagasse aqui
    antes). state_transitions e ai_decision_logs são ON DELETE CASCADE,
    somem sozinhos."""
    await db.execute(delete(MessageLog).where(MessageLog.occurrence_id == occurrence.id))
    await db.delete(occurrence)
    await db.flush()


async def delete_all_occurrence_history(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Limpa TODO o histórico do tenant de uma vez (mesma lógica de
    delete_occurrence_history, em massa) — usado pelo botão "Limpar todo
    o histórico" no dashboard, restrito a admin do tenant. Retorna quantas
    ocorrências foram removidas."""
    await db.execute(
        delete(MessageLog).where(
            MessageLog.occurrence_id.in_(
                select(Occurrence.id).where(Occurrence.tenant_id == tenant_id)
            )
        )
    )
    result = await db.execute(delete(Occurrence).where(Occurrence.tenant_id == tenant_id))
    await db.flush()
    return result.rowcount
