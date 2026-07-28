"""
Testes de app.services.escalation_service. Tenants aqui sempre têm
message_templates={} (nenhuma chave configurada) — render_template retorna
None pra tudo, então o cliente evolution-go nunca é de fato chamado
(ver guardas "if driver_text:" / "if customer_text:" no service), o que
permite testar contra o Postgres real sem precisar de rede/gateway.
Endereços ficam None nos casos de novo endereço pra não disparar a
tentativa (best-effort) de geocoding real durante o teste.
"""
import uuid

import pytest

from app.core.config import get_settings
from app.db.models.enums import FailureReason, OccurrenceState, TransitionActor
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.schemas.ai_outputs import ReplyCategory
from app.services.escalation_service import (
    InvalidEscalationStateError,
    resolve_classification_escalation,
    resolve_reply_escalation,
)
from app.state_machine.engine import transition


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-escalacao-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Escalação Teste", slug=slug,
        evolution_instance=slug, evolution_token="token-fake",
        message_templates={},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def _make_escalated_occurrence(db_session, tenant: Tenant, *, with_customer: bool) -> Occurrence:
    occurrence = Occurrence(tenant_id=tenant.id, driver_phone="5511900000000")
    db_session.add(occurrence)
    await db_session.flush()

    await transition(db_session, occurrence, OccurrenceState.CLASSIFYING, TransitionActor.SYSTEM)

    if with_customer:
        occurrence.customer_phone = "5511911111111"
        occurrence.customer_name = "Cliente Teste"
        occurrence.route_id = "ROTA-1"
        await transition(db_session, occurrence, OccurrenceState.PENDING_HUMAN_QUEUE, TransitionActor.AI)
        await transition(
            db_session, occurrence, OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1, TransitionActor.HUMAN_OPERATOR
        )
        await transition(
            db_session, occurrence, OccurrenceState.AWAITING_CUSTOMER_REPLY_1, TransitionActor.AI
        )
        await transition(db_session, occurrence, OccurrenceState.PROCESSING_REPLY, TransitionActor.CUSTOMER)

    await transition(db_session, occurrence, OccurrenceState.ESCALATED_TO_HUMAN, TransitionActor.AI)
    return occurrence


async def test_resolve_classification_escalation_refused_closes_definitive_failure(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=False)

    result = await resolve_classification_escalation(
        db_session, get_settings(), tenant, occurrence, failure_reason=FailureReason.REFUSED
    )

    assert result.state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE
    assert result.requires_customer_contact is False


async def test_resolve_classification_escalation_other_reason_goes_to_human_queue(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=False)

    result = await resolve_classification_escalation(
        db_session, get_settings(), tenant, occurrence, failure_reason=FailureReason.DAMAGE
    )

    assert result.state == OccurrenceState.PENDING_HUMAN_QUEUE
    assert result.requires_customer_contact is True


async def test_resolve_classification_escalation_rejects_when_already_past_that_stage(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=True)

    with pytest.raises(InvalidEscalationStateError):
        await resolve_classification_escalation(
            db_session, get_settings(), tenant, occurrence, failure_reason=FailureReason.DAMAGE
        )


async def test_resolve_reply_escalation_confirms_reschedule_closes_resolved(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=True)

    result = await resolve_reply_escalation(
        db_session, get_settings(), tenant, occurrence, category=ReplyCategory.CONFIRMS_RESCHEDULE
    )

    assert result.state == OccurrenceState.CLOSED_RESOLVED
    assert result.closed_at is not None


async def test_resolve_reply_escalation_definitive_refusal_closes_failed(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=True)

    result = await resolve_reply_escalation(
        db_session, get_settings(), tenant, occurrence, category=ReplyCategory.DEFINITIVE_REFUSAL
    )

    assert result.state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE


async def test_resolve_reply_escalation_new_address_within_radius_closes_resolved(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=True)

    result = await resolve_reply_escalation(
        db_session, get_settings(), tenant, occurrence,
        category=ReplyCategory.REQUESTS_NEW_ADDRESS,
        new_address_text="Rua Nova, 123", within_radius=True,
    )

    assert result.state == OccurrenceState.CLOSED_RESOLVED
    assert result.within_radius is True
    assert result.new_address_text == "Rua Nova, 123"


async def test_resolve_reply_escalation_new_address_outside_radius_closes_failed(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=True)

    result = await resolve_reply_escalation(
        db_session, get_settings(), tenant, occurrence,
        category=ReplyCategory.REQUESTS_NEW_ADDRESS,
        new_address_text="Rua Distante, 999", within_radius=False,
    )

    assert result.state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE
    assert result.within_radius is False


async def test_resolve_reply_escalation_new_address_requires_fields(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=True)

    with pytest.raises(ValueError):
        await resolve_reply_escalation(
            db_session, get_settings(), tenant, occurrence,
            category=ReplyCategory.REQUESTS_NEW_ADDRESS,
        )


async def test_resolve_reply_escalation_rejects_when_still_at_classification_stage(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_escalated_occurrence(db_session, tenant, with_customer=False)

    with pytest.raises(InvalidEscalationStateError):
        await resolve_reply_escalation(
            db_session, get_settings(), tenant, occurrence, category=ReplyCategory.CONFIRMS_RESCHEDULE
        )
