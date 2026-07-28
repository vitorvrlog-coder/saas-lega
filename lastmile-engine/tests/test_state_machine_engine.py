import uuid

import pytest
from sqlalchemy import select

from app.db.models.enums import OccurrenceState, TransitionActor
from app.db.models.occurrence import Occurrence
from app.db.models.state_transition import StateTransition
from app.db.models.tenant import Tenant
from app.state_machine.engine import InvalidTransitionError, transition


async def _make_tenant(db_session) -> Tenant:
    tenant = Tenant(
        name="Teste Unit",
        slug=f"teste-unit-{uuid.uuid4().hex[:10]}",
        evolution_instance="inst-unit",
        evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def _make_occurrence(db_session, tenant: Tenant) -> Occurrence:
    occurrence = Occurrence(tenant_id=tenant.id, driver_phone="5511900000000")
    db_session.add(occurrence)
    await db_session.flush()
    return occurrence


async def test_valid_transition_updates_state(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_occurrence(db_session, tenant)

    await transition(db_session, occurrence, OccurrenceState.CLASSIFYING, TransitionActor.SYSTEM)

    assert occurrence.state == OccurrenceState.CLASSIFYING


async def test_transition_logs_append_only_history(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_occurrence(db_session, tenant)

    await transition(db_session, occurrence, OccurrenceState.CLASSIFYING, TransitionActor.SYSTEM, reason="r1")
    await transition(
        db_session, occurrence, OccurrenceState.PENDING_HUMAN_QUEUE, TransitionActor.AI, reason="r2"
    )

    rows = (
        await db_session.execute(
            select(StateTransition).where(StateTransition.occurrence_id == occurrence.id)
        )
    ).scalars().all()

    assert len(rows) == 2
    assert rows[0].from_state == OccurrenceState.REPORTED
    assert rows[0].to_state == OccurrenceState.CLASSIFYING
    assert rows[1].from_state == OccurrenceState.CLASSIFYING
    assert rows[1].to_state == OccurrenceState.PENDING_HUMAN_QUEUE


async def test_invalid_transition_raises_and_does_not_change_state(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_occurrence(db_session, tenant)

    with pytest.raises(InvalidTransitionError):
        await transition(db_session, occurrence, OccurrenceState.CLOSED_RESOLVED, TransitionActor.SYSTEM)

    assert occurrence.state == OccurrenceState.REPORTED
