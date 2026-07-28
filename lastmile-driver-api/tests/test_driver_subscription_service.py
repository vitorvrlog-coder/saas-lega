"""Testes básicos de app.services.driver_subscription_service — assinatura
paga do motorista via Asaas, desacoplada da cobrança da transportadora."""
import uuid

import pytest

from app.core.config import get_settings
from app.db.models.driver import Driver
from app.db.models.enums import DriverSubscriptionStatus
from app.db.models.tenant import Tenant
from app.services import driver_subscription_service
from app.services.driver_subscription_service import (
    DriverMissingCPFError,
    DriverNotLinkedError,
    start_subscription,
)


class _FakeAsaasClient:
    async def find_customer_by_cpf(self, cpf: str):
        return None

    async def create_customer(self, name: str, cpf: str, phone: str) -> dict:
        return {"id": "cus_123"}

    async def create_subscription(self, *, customer_id, value, next_due_date, billing_type) -> dict:
        return {"id": "sub_123", "invoiceUrl": "https://asaas.example/pay/sub_123"}


class _FakeEvolutionClient:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send_text(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net"}}}


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-subscription-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Assinatura Teste", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={"subscription_payment_link": "Segue seu link de pagamento: {payment_link}"},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def _make_driver(db_session, tenant: Tenant, *, cpf: str | None = "12345678901") -> Driver:
    driver = Driver(tenant_id=tenant.id, phone="5547999998888", name="João", cpf=cpf)
    db_session.add(driver)
    await db_session.flush()
    return driver


async def test_start_subscription_creates_and_sends_payment_link(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    fake_asaas = _FakeAsaasClient()
    fake_wa = _FakeEvolutionClient()
    monkeypatch.setattr(driver_subscription_service, "_asaas_client", lambda settings: fake_asaas)
    monkeypatch.setattr(driver_subscription_service, "evolution_client_for", lambda t, s: fake_wa)

    subscription = await start_subscription(db_session, get_settings(), tenant, driver)

    assert subscription.status == DriverSubscriptionStatus.PENDING
    assert subscription.checkout_url == "https://asaas.example/pay/sub_123"
    assert len(fake_wa.sent) == 1
    assert fake_wa.sent[0][0] == driver.phone


async def test_start_subscription_raises_when_driver_not_linked(db_session):
    tenant = await _make_tenant(db_session)
    driver = Driver(tenant_id=None, phone="5547999998888", cpf="12345678901")
    db_session.add(driver)
    await db_session.flush()

    with pytest.raises(DriverNotLinkedError):
        await start_subscription(db_session, get_settings(), tenant, driver)


async def test_start_subscription_raises_when_missing_cpf(db_session):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant, cpf=None)

    with pytest.raises(DriverMissingCPFError):
        await start_subscription(db_session, get_settings(), tenant, driver)
