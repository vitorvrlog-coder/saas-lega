"""Testes básicos de app.services.driver_subscription_service — assinatura
paga do motorista via Asaas, desacoplada da cobrança da transportadora.
Fluxo em duas etapas: start_subscription só prepara o link de checkout
próprio; capture_subscription_card (chamado da página de checkout) é quem
de fato tokeniza o cartão e cria a cobrança recorrente no Asaas."""
import uuid

import pytest

from app.core.config import get_settings
from app.db.models.driver import Driver
from app.db.models.driver_subscription import DriverSubscription
from app.db.models.enums import DriverSubscriptionStatus
from app.db.models.tenant import Tenant
from app.services import driver_subscription_service
from app.services.driver_subscription_service import (
    DriverMissingCPFError,
    DriverNotLinkedError,
    capture_subscription_card,
    handle_webhook_event,
    start_subscription,
)


class _FakeAsaasClient:
    def __init__(self):
        self.create_subscription_calls: list[dict] = []

    async def find_customer_by_cpf(self, cpf: str):
        return None

    async def create_customer(self, name: str, cpf: str, phone: str) -> dict:
        return {"id": "cus_123"}

    async def tokenize_credit_card(self, customer_id, **kwargs) -> dict:
        return {"creditCardToken": "card_token_abc"}

    async def create_subscription(self, *, customer_id, value, next_due_date, billing_type, **kwargs) -> dict:
        self.create_subscription_calls.append(
            {"customer_id": customer_id, "billing_type": billing_type, **kwargs}
        )
        return {"id": "sub_123"}


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


async def test_start_subscription_creates_local_row_and_sends_checkout_link(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    fake_asaas = _FakeAsaasClient()
    fake_wa = _FakeEvolutionClient()
    monkeypatch.setattr(driver_subscription_service, "_asaas_client", lambda settings: fake_asaas)
    monkeypatch.setattr(driver_subscription_service, "evolution_client_for", lambda t, s: fake_wa)

    subscription = await start_subscription(db_session, get_settings(), tenant, driver)

    # Nenhuma cobrança existe no Asaas ainda — só o customer e a linha local.
    assert subscription.status == DriverSubscriptionStatus.PENDING
    assert subscription.asaas_subscription_id is None
    assert subscription.checkout_url is not None
    assert f"/checkout/" in subscription.checkout_url
    assert len(fake_wa.sent) == 1
    assert fake_wa.sent[0][0] == driver.phone
    assert subscription.checkout_url in fake_wa.sent[0][1]


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


async def test_capture_subscription_card_tokenizes_and_creates_recurring_subscription(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    fake_asaas = _FakeAsaasClient()
    monkeypatch.setattr(driver_subscription_service, "_asaas_client", lambda settings: fake_asaas)

    subscription = DriverSubscription(
        driver_id=driver.id, asaas_customer_id="cus_123",
        status=DriverSubscriptionStatus.PENDING, value=35.00, billing_type="CREDIT_CARD",
    )
    db_session.add(subscription)
    await db_session.flush()

    result = await capture_subscription_card(
        db_session, get_settings(), subscription,
        holder_name="João da Silva", number="4111111111111111",
        expiry_month="12", expiry_year="2030", ccv="123",
        email="joao@example.com", cpf="12345678901",
        postal_code="89000000", address_number="100", phone="5547999998888",
        remote_ip="203.0.113.10",
    )

    assert result.asaas_subscription_id == "sub_123"
    assert result.asaas_credit_card_token == "card_token_abc"
    assert result.next_due_date is not None
    call = fake_asaas.create_subscription_calls[0]
    assert call["billing_type"] == "CREDIT_CARD"
    assert call["credit_card_token"] == "card_token_abc"
    assert call["remote_ip"] == "203.0.113.10"


async def test_webhook_card_capture_refused_marks_card_declined(db_session):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    subscription = DriverSubscription(
        driver_id=driver.id, asaas_customer_id="cus_123", asaas_subscription_id="sub_999",
        status=DriverSubscriptionStatus.PENDING, value=35.00, billing_type="CREDIT_CARD",
    )
    db_session.add(subscription)
    await db_session.flush()

    updated = await handle_webhook_event(
        db_session,
        {"event": "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "payment": {"subscription": "sub_999"}},
    )

    assert updated is not None
    assert updated.status == DriverSubscriptionStatus.CARD_DECLINED
