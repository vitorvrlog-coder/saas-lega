import uuid

from app.db.models.tenant import Tenant
from app.services.idempotency_service import is_duplicate_event


async def _make_tenant(db_session) -> Tenant:
    tenant = Tenant(
        name="Teste Idempotencia",
        slug=f"teste-idem-{uuid.uuid4().hex[:10]}",
        evolution_instance="inst-idem",
        evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def test_first_event_is_not_duplicate(db_session):
    tenant = await _make_tenant(db_session)
    result = await is_duplicate_event(db_session, tenant.id, "MSG-A", "Message")
    assert result is False


async def test_repeated_event_is_duplicate(db_session):
    tenant = await _make_tenant(db_session)
    await is_duplicate_event(db_session, tenant.id, "MSG-B", "Message")
    result = await is_duplicate_event(db_session, tenant.id, "MSG-B", "Message")
    assert result is True


async def test_missing_external_id_never_flags_duplicate(db_session):
    tenant = await _make_tenant(db_session)
    first = await is_duplicate_event(db_session, tenant.id, None, "Message")
    second = await is_duplicate_event(db_session, tenant.id, None, "Message")
    assert first is False
    assert second is False


async def test_same_message_id_different_tenants_not_duplicate(db_session):
    tenant_a = await _make_tenant(db_session)
    tenant_b = await _make_tenant(db_session)

    result_a = await is_duplicate_event(db_session, tenant_a.id, "MSG-SHARED", "Message")
    result_b = await is_duplicate_event(db_session, tenant_b.id, "MSG-SHARED", "Message")

    assert result_a is False
    assert result_b is False
