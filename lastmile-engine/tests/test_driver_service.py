"""Testes de app.services.driver_service — cadastro persistente de
motorista, chave (tenant_id, phone) normalizado."""
import uuid

import pytest

from app.db.models.tenant import Tenant
from app.services.driver_service import get_or_create_driver, update_driver


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-driver-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Motorista Teste", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def test_get_or_create_driver_creates_new(db_session):
    tenant = await _make_tenant(db_session)

    driver = await get_or_create_driver(db_session, tenant.id, "47999998888", name="João")

    assert driver.tenant_id == tenant.id
    assert driver.phone == "5547999998888"
    assert driver.name == "João"


async def test_get_or_create_driver_reuses_existing_without_duplicating(db_session):
    tenant = await _make_tenant(db_session)

    first = await get_or_create_driver(db_session, tenant.id, "47999998888")
    second = await get_or_create_driver(db_session, tenant.id, "47999998888")

    assert first.id == second.id


async def test_get_or_create_driver_normalizes_phone_before_matching(db_session):
    tenant = await _make_tenant(db_session)

    first = await get_or_create_driver(db_session, tenant.id, "47999998888")
    # Mesmo número, mas já com DDI — deve casar com o mesmo cadastro.
    second = await get_or_create_driver(db_session, tenant.id, "5547999998888")

    assert first.id == second.id


async def test_get_or_create_driver_never_overwrites_known_name_with_none(db_session):
    tenant = await _make_tenant(db_session)

    await get_or_create_driver(db_session, tenant.id, "47999998888", name="João")
    driver = await get_or_create_driver(db_session, tenant.id, "47999998888", name=None)

    assert driver.name == "João"


async def test_update_driver_sets_vehicle_fields(db_session):
    tenant = await _make_tenant(db_session)
    driver = await get_or_create_driver(db_session, tenant.id, "47999998888")

    await update_driver(db_session, driver, name="João", vehicle_plate="ABC1234", vehicle_type="moto")

    assert driver.name == "João"
    assert driver.vehicle_plate == "ABC1234"
    assert driver.vehicle_type == "moto"
