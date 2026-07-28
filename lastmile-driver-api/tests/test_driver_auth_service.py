"""Testes básicos de app.services.driver_auth_service — login do motorista
por código de 6 dígitos enviado via WhatsApp, uso único."""
import uuid

from app.core.config import get_settings
from app.db.models.driver import Driver
from app.db.models.tenant import Tenant
from app.services import driver_auth_service
from app.services.driver_auth_service import issue_login_code, send_login_code, verify_login_code


class _FakeEvolutionClient:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send_text(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net"}}}


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-driverauth-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Login Motorista", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={"driver_login_code": "Seu código de acesso é {code}"},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def _make_driver(db_session, tenant: Tenant) -> Driver:
    driver = Driver(tenant_id=tenant.id, phone="5547999998888", name="João")
    db_session.add(driver)
    await db_session.flush()
    return driver


async def test_issue_login_code_generates_six_digits(db_session):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)

    code = await issue_login_code(db_session, driver)

    assert len(code) == 6
    assert code.isdigit()


async def test_verify_login_code_accepts_correct_code_once(db_session):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    code = await issue_login_code(db_session, driver)

    assert await verify_login_code(db_session, driver, code) is True
    # Reuso do mesmo código (replay) não é mais aceito.
    assert await verify_login_code(db_session, driver, code) is False


async def test_verify_login_code_rejects_wrong_code(db_session):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    await issue_login_code(db_session, driver)

    assert await verify_login_code(db_session, driver, "000000") is False


async def test_send_login_code_delivers_via_whatsapp(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    fake = _FakeEvolutionClient()
    monkeypatch.setattr(driver_auth_service, "evolution_client_for", lambda t, s: fake)

    await send_login_code(db_session, get_settings(), tenant, driver, "123456")

    assert len(fake.sent) == 1
    phone, text = fake.sent[0]
    assert phone == driver.phone
    assert "123456" in text
