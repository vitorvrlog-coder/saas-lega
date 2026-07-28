"""
Testes de app.services.tenant_service. A criação real de instância no
gateway evolution-go (rede + side effect externo persistente) é validada
manualmente contra o gateway de verdade, não aqui — os casos abaixo cobrem
os ramos de decisão que rodam ANTES de qualquer chamada de rede (slug
duplicado, chave mestre ausente) e a edição pura de campos já persistidos,
sem precisar mockar o cliente HTTP.
"""
import datetime
import uuid

import pytest

from app.core.config import get_settings
from app.db.models.driver import Driver
from app.db.models.occurrence import Occurrence
from app.db.models.route_manifest import RouteManifest
from app.db.models.tenant import Tenant
from app.services.tenant_service import (
    DuplicateTenantSlugError,
    TenantHasDataError,
    TenantProvisioningError,
    create_tenant,
    delete_tenant,
    set_tenant_active,
    update_tenant,
)


def _unique_slug() -> str:
    return f"tenant-teste-{uuid.uuid4().hex[:8]}"


async def _make_tenant(db_session, slug: str) -> Tenant:
    tenant = Tenant(
        name="Tenant de teste",
        slug=slug,
        evolution_instance=slug,
        evolution_token="token-fake",
        allowed_radius_km=2.0,
        timeout_attempt_1_minutes=30,
        timeout_attempt_2_minutes=60,
        message_templates={},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def test_create_tenant_raises_for_duplicate_slug(db_session):
    slug = _unique_slug()
    await _make_tenant(db_session, slug)

    with pytest.raises(DuplicateTenantSlugError):
        await create_tenant(
            db_session, get_settings(),
            name="Outro nome", slug=slug,
            allowed_radius_km=2.0,
            timeout_attempt_1_minutes=30,
            timeout_attempt_2_minutes=60,
        )


async def test_create_tenant_raises_when_global_api_key_missing(db_session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "EVOLUTION_GLOBAL_API_KEY", None)

    with pytest.raises(TenantProvisioningError):
        await create_tenant(
            db_session, settings,
            name="Tenant sem chave", slug=_unique_slug(),
            allowed_radius_km=2.0,
            timeout_attempt_1_minutes=30,
            timeout_attempt_2_minutes=60,
        )


async def test_update_tenant_edits_business_fields_and_templates(db_session):
    tenant = await _make_tenant(db_session, _unique_slug())

    updated = await update_tenant(
        db_session, tenant,
        name="Nome atualizado",
        allowed_radius_km=5.0,
        timeout_attempt_1_minutes=45,
        timeout_attempt_2_minutes=90,
        message_templates={"contact_customer_attempt_1": "Olá {original_address}"},
    )

    assert updated.name == "Nome atualizado"
    assert float(updated.allowed_radius_km) == 5.0
    assert updated.timeout_attempt_1_minutes == 45
    assert updated.timeout_attempt_2_minutes == 90
    assert updated.message_templates == {"contact_customer_attempt_1": "Olá {original_address}"}


async def test_delete_tenant_succeeds_when_no_data(db_session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "EVOLUTION_GLOBAL_API_KEY", None)
    tenant = await _make_tenant(db_session, _unique_slug())

    await delete_tenant(db_session, settings, tenant)

    assert (await db_session.get(Tenant, tenant.id)) is None


async def test_delete_tenant_blocked_by_occurrence(db_session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "EVOLUTION_GLOBAL_API_KEY", None)
    tenant = await _make_tenant(db_session, _unique_slug())
    db_session.add(Occurrence(tenant_id=tenant.id, driver_phone="5511999990000"))
    await db_session.flush()

    with pytest.raises(TenantHasDataError):
        await delete_tenant(db_session, settings, tenant)


async def test_delete_tenant_blocked_by_route_manifest(db_session, monkeypatch):
    """Regressão: antes desse guard, apagar um tenant com planilha de rota
    associada estourava IntegrityError não tratada (FK RESTRICT em
    route_manifests) e virava 500 na tela — confirmado ao vivo com o tenant
    'Tenant Planilha Rota'."""
    settings = get_settings()
    monkeypatch.setattr(settings, "EVOLUTION_GLOBAL_API_KEY", None)
    tenant = await _make_tenant(db_session, _unique_slug())
    db_session.add(
        RouteManifest(tenant_id=tenant.id, filename="rota.csv", route_date=datetime.date.today())
    )
    await db_session.flush()

    with pytest.raises(TenantHasDataError):
        await delete_tenant(db_session, settings, tenant)


async def test_delete_tenant_blocked_by_driver(db_session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "EVOLUTION_GLOBAL_API_KEY", None)
    tenant = await _make_tenant(db_session, _unique_slug())
    db_session.add(Driver(tenant_id=tenant.id, phone="5511999990000"))
    await db_session.flush()

    with pytest.raises(TenantHasDataError):
        await delete_tenant(db_session, settings, tenant)


async def test_set_tenant_active_toggles(db_session):
    tenant = await _make_tenant(db_session, _unique_slug())
    assert tenant.is_active is True

    await set_tenant_active(db_session, tenant, False)
    assert tenant.is_active is False

    await set_tenant_active(db_session, tenant, True)
    assert tenant.is_active is True
