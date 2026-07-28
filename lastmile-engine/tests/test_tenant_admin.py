"""
Testes do papel "admin de tenant" (representa a transportadora, gerencia só
os operadores do próprio tenant). real_auth desliga o bypass de dev — sem
ele, todo mundo vira admin da plataforma fantasma e o papel nunca seria de
fato exercitado. Dados commitados de verdade (não rollback) porque o
web_client abre sua própria sessão contra o banco.
"""
import uuid

import httpx
import pytest

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import AsyncSessionLocal
from app.main import app
from app.services.user_service import create_tenant_operator, set_tenant_admin


@pytest.fixture
async def web_client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def real_auth(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "test-internal-key")
    return settings


@pytest.fixture
async def tenant_with_admin_and_operator(real_auth):
    async with AsyncSessionLocal() as db:
        tenant_a = Tenant(
            name="Tenant Admin Teste", slug=f"tenant-admin-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-admin-{uuid.uuid4().hex[:8]}", evolution_token="tok-a",
        )
        tenant_b = Tenant(
            name="Tenant Admin Teste B", slug=f"tenant-admin-b-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-admin-b-{uuid.uuid4().hex[:8]}", evolution_token="tok-b",
        )
        db.add_all([tenant_a, tenant_b])
        await db.flush()

        admin_password = "senha-admin-tenant-123"
        tenant_admin = User(
            tenant_id=tenant_a.id,
            email=f"tenant-admin-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(admin_password),
            is_platform_admin=False, is_tenant_admin=True,
        )
        plain_password = "senha-operador-comum-123"
        plain_operator = User(
            tenant_id=tenant_a.id,
            email=f"operador-comum-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(plain_password),
            is_platform_admin=False, is_tenant_admin=False,
        )
        other_tenant_operator = User(
            tenant_id=tenant_b.id,
            email=f"operador-outro-tenant-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password("outrasenha123"),
            is_platform_admin=False, is_tenant_admin=False,
        )
        db.add_all([tenant_admin, plain_operator, other_tenant_operator])
        await db.commit()
        for obj in (tenant_a, tenant_b, tenant_admin, plain_operator, other_tenant_operator):
            await db.refresh(obj)

        yield {
            "tenant_a": tenant_a, "tenant_b": tenant_b,
            "tenant_admin": tenant_admin, "tenant_admin_password": admin_password,
            "plain_operator": plain_operator, "plain_operator_password": plain_password,
            "other_tenant_operator": other_tenant_operator,
        }

        await db.delete(tenant_a)
        await db.delete(tenant_b)
        await db.commit()


async def _login(web_client: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    return await web_client.post(
        "/web/login", data={"email": email, "password": password}, follow_redirects=False
    )


async def test_create_tenant_operator_with_tenant_admin_flag(db_session):
    tenant = Tenant(
        name="Tenant Criação Teste", slug=f"tenant-criacao-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-criacao-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    user = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"admin-{uuid.uuid4().hex[:8]}@teste.com",
        password="senha12345", is_tenant_admin=True,
    )
    assert user.is_tenant_admin is True
    assert user.is_platform_admin is False


async def test_set_tenant_admin_toggles(db_session):
    tenant = Tenant(
        name="Tenant Toggle Teste", slug=f"tenant-toggle-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-toggle-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    user = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"op-{uuid.uuid4().hex[:8]}@teste.com", password="senha12345"
    )
    assert user.is_tenant_admin is False

    await set_tenant_admin(db_session, user, True)
    assert user.is_tenant_admin is True

    await set_tenant_admin(db_session, user, False)
    assert user.is_tenant_admin is False


async def test_tenant_admin_can_access_my_operators_page(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    response = await web_client.get("/web/my-tenant/operators")
    assert response.status_code == 200
    assert data["plain_operator"].email in response.text


async def test_plain_operator_cannot_access_my_operators_page(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["plain_operator"].email, data["plain_operator_password"])

    response = await web_client.get("/web/my-tenant/operators")
    assert response.status_code == 403


async def test_tenant_admin_cannot_access_tenant_management(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    response = await web_client.get("/backoffice/tenants")
    assert response.status_code == 403


async def test_tenant_admin_creates_new_operator_without_admin_flag(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    new_email = f"novo-operador-{uuid.uuid4().hex[:8]}@teste.com"
    response = await web_client.post(
        "/web/my-tenant/operators", data={"email": new_email, "password": "senhanova123"},
        follow_redirects=False,
    )
    assert response.status_code == 303

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(select(User).where(User.email == new_email))
        created = result.scalar_one()
        assert created.is_tenant_admin is False
        assert created.tenant_id == data["tenant_a"].id


async def test_tenant_admin_cannot_toggle_active_on_other_tenant_operator(
    web_client, tenant_with_admin_and_operator
):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    other = data["other_tenant_operator"]
    await web_client.post(f"/web/my-tenant/operators/{other.id}/toggle-active")

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, other.id)
        assert refreshed.is_active == other.is_active  # não mudou


async def test_tenant_admin_cannot_deactivate_self(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    admin = data["tenant_admin"]
    await web_client.post(f"/web/my-tenant/operators/{admin.id}/toggle-active")

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, admin.id)
        assert refreshed.is_active is True


async def test_tenant_admin_can_access_my_tenant_page(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    response = await web_client.get("/web/my-tenant")
    assert response.status_code == 200
    assert data["tenant_a"].name in response.text


async def test_plain_operator_can_also_access_my_tenant_page(web_client, tenant_with_admin_and_operator):
    """Diferente de "Meus Operadores" (só admin de tenant), a aba "Tenant"
    (info do próprio tenant) é liberada pra qualquer um vinculado ao
    tenant, admin ou não."""
    data = tenant_with_admin_and_operator
    await _login(web_client, data["plain_operator"].email, data["plain_operator_password"])

    response = await web_client.get("/web/my-tenant")
    assert response.status_code == 200
    assert data["tenant_a"].name in response.text


async def test_platform_admin_cannot_access_my_tenant_page(web_client, real_auth):
    """Admin da plataforma não pertence a tenant nenhum — usa o backoffice
    pra ver qualquer transportadora, não essa tela."""
    from app.core.security import hash_password
    from app.db.models.user import User as UserModel

    async with AsyncSessionLocal() as db:
        admin = UserModel(
            tenant_id=None,
            email=f"plat-admin-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password("senhaadmin123"),
            is_platform_admin=True,
        )
        db.add(admin)
        await db.commit()
        await db.refresh(admin)

    try:
        await _login(web_client, admin.email, "senhaadmin123")
        response = await web_client.get("/web/my-tenant")
        assert response.status_code == 403
    finally:
        async with AsyncSessionLocal() as db:
            await db.delete(await db.get(UserModel, admin.id))
            await db.commit()


async def test_backoffice_link_absent_from_operational_nav(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    response = await web_client.get("/web/")
    assert "Backoffice" not in response.text
    assert "/web/my-tenant\"" in response.text


async def test_tenant_admin_can_access_templates_page(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    response = await web_client.get("/web/my-tenant/templates")
    assert response.status_code == 200
    assert "Templates de mensagem" in response.text


async def test_plain_operator_cannot_access_templates_page(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["plain_operator"].email, data["plain_operator_password"])

    response = await web_client.get("/web/my-tenant/templates")
    assert response.status_code == 403


async def test_tenant_admin_saves_template(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    response = await web_client.post(
        "/web/my-tenant/templates",
        data={"template_contact_customer_attempt_1": "Ola {original_address}, houve um problema."},
        follow_redirects=False,
    )
    assert response.status_code == 303

    async with AsyncSessionLocal() as db:
        tenant = await db.get(Tenant, data["tenant_a"].id)
        assert tenant.message_templates.get("contact_customer_attempt_1") == "Ola {original_address}, houve um problema."


async def test_backoffice_tenant_detail_no_longer_shows_templates_section(
    web_client, tenant_with_platform_admin_no_operator
):
    data = tenant_with_platform_admin_no_operator
    await _login(web_client, data["admin"].email, data["admin_password"])

    response = await web_client.get(f"/backoffice/tenants/{data['tenant'].id}")
    assert response.status_code == 200
    assert "Templates de mensagem" not in response.text


@pytest.fixture
async def tenant_with_platform_admin_no_operator(real_auth):
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Tenant Sem Template Teste", slug=f"tenant-sem-template-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-sem-template-{uuid.uuid4().hex[:8]}", evolution_token="tok",
        )
        admin_password = "senha-admin-tpl-123"
        admin = User(
            tenant_id=None, email=f"admin-tpl-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(admin_password), is_platform_admin=True,
        )
        db.add_all([tenant, admin])
        await db.commit()
        await db.refresh(tenant)
        await db.refresh(admin)

        yield {"tenant": tenant, "admin": admin, "admin_password": admin_password}

        await db.delete(admin)
        await db.commit()
        await db.delete(tenant)
        await db.commit()


async def test_tenant_admin_resets_own_operator_password(web_client, tenant_with_admin_and_operator):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    response = await web_client.post(
        f"/web/my-tenant/operators/{data['plain_operator'].id}/reset-password",
        data={"new_password": "senharesetadatenant123"},
        follow_redirects=False,
    )
    assert response.status_code == 303

    old_login = await _login(web_client, data["plain_operator"].email, data["plain_operator_password"])
    assert old_login.status_code == 401

    new_login = await _login(web_client, data["plain_operator"].email, "senharesetadatenant123")
    assert new_login.status_code == 303


async def test_tenant_admin_cannot_reset_other_tenant_operator_password(
    web_client, tenant_with_admin_and_operator
):
    data = tenant_with_admin_and_operator
    await _login(web_client, data["tenant_admin"].email, data["tenant_admin_password"])

    other = data["other_tenant_operator"]
    await web_client.post(
        f"/web/my-tenant/operators/{other.id}/reset-password",
        data={"new_password": "naodeveriafuncionar123"},
    )

    # a senha original do operador de outro tenant continua válida — o
    # reset foi ignorado (guarda de tenant_id na rota).
    original_login = await _login(web_client, other.email, "outrasenha123")
    assert original_login.status_code == 303

    blocked_login = await _login(web_client, other.email, "naodeveriafuncionar123")
    assert blocked_login.status_code == 401
