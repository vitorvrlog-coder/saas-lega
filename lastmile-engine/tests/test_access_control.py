"""
Testes de controle de acesso do dashboard (app.web). O bypass de dev
(INTERNAL_API_KEY=None, usado no resto da suíte) precisa ser desligado aqui
de propósito — sem ele, toda requisição vira automaticamente um admin da
plataforma "fantasma" e o escopo por tenant nunca seria de fato exercitado.

Tenants/ocorrências/usuários usados aqui são commitados de verdade (não
rollback-only) porque o web_client faz requisições HTTP reais contra
app.main.app, que abre sua própria sessão de banco por requisição — uma
sessão só-rollback não seria visível para ela. Limpos no teardown.
"""
import uuid

import httpx
import pytest

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import AsyncSessionLocal
from app.main import app
from app.services.user_service import DuplicateEmailError, create_tenant_operator, delete_user
from app.web.auth import authenticate_user


@pytest.fixture
async def web_client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def real_auth(monkeypatch):
    """Desliga o bypass de dev só pro teste, forçando o caminho real de
    sessão/login (o resto da suíte roda com INTERNAL_API_KEY=None)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "test-internal-key")
    return settings


@pytest.fixture
async def two_tenants_with_operator(real_auth):
    async with AsyncSessionLocal() as db:
        tenant_a = Tenant(
            name="Tenant A Teste Acesso", slug=f"tenant-a-acesso-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-a-{uuid.uuid4().hex[:8]}", evolution_token="tok-a",
        )
        tenant_b = Tenant(
            name="Tenant B Teste Acesso", slug=f"tenant-b-acesso-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-b-{uuid.uuid4().hex[:8]}", evolution_token="tok-b",
        )
        db.add_all([tenant_a, tenant_b])
        await db.flush()

        occurrence_a = Occurrence(tenant_id=tenant_a.id, driver_phone="5511900000001")
        occurrence_b = Occurrence(tenant_id=tenant_b.id, driver_phone="5511900000002")
        db.add_all([occurrence_a, occurrence_b])

        password = "senha-operador-123"
        operator_a = User(
            tenant_id=tenant_a.id,
            email=f"operador-a-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(password),
            is_platform_admin=False,
        )
        db.add(operator_a)
        await db.commit()
        for obj in (tenant_a, tenant_b, occurrence_a, occurrence_b, operator_a):
            await db.refresh(obj)

        yield {
            "tenant_a": tenant_a, "tenant_b": tenant_b,
            "occurrence_a": occurrence_a, "occurrence_b": occurrence_b,
            "operator_a": operator_a, "operator_a_password": password,
        }

        await db.delete(occurrence_a)
        await db.delete(occurrence_b)
        await db.commit()
        # operator_a cai em cascata (FK ondelete=CASCADE) ao apagar tenant_a —
        # não apaga explicitamente aqui pra não competir com o cascade do
        # banco pela mesma linha.
        await db.delete(tenant_a)
        await db.delete(tenant_b)
        await db.commit()


async def _login(web_client: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    return await web_client.post(
        "/web/login", data={"email": email, "password": password}, follow_redirects=False
    )


async def test_login_with_wrong_password_fails(web_client, two_tenants_with_operator):
    data = two_tenants_with_operator
    response = await _login(web_client, data["operator_a"].email, "senha-errada")
    assert response.status_code == 401
    assert "inválidos" in response.text


async def test_login_with_correct_password_succeeds(web_client, two_tenants_with_operator):
    data = two_tenants_with_operator
    response = await _login(web_client, data["operator_a"].email, data["operator_a_password"])
    assert response.status_code == 303
    assert response.headers["location"] == "/web/"


async def test_login_is_case_insensitive_on_email(web_client, two_tenants_with_operator):
    """Regressão: e-mail cadastrado como 'joao@x.com' precisa logar mesmo
    se digitado 'Joao@X.com' — sem normalização, essa comparação falhava
    silenciosamente e a conta parecia "não ativada"."""
    data = two_tenants_with_operator
    shouted_email = data["operator_a"].email.upper()
    response = await _login(web_client, shouted_email, data["operator_a_password"])
    assert response.status_code == 303
    assert response.headers["location"] == "/web/"


async def test_tenant_operator_only_sees_own_tenant_occurrences(web_client, two_tenants_with_operator):
    data = two_tenants_with_operator
    await _login(web_client, data["operator_a"].email, data["operator_a_password"])

    response = await web_client.get("/web/occurrences")
    assert response.status_code == 200
    assert data["occurrence_a"].driver_phone in response.text
    assert data["occurrence_b"].driver_phone not in response.text


async def test_tenant_operator_cannot_access_tenant_management(web_client, two_tenants_with_operator):
    data = two_tenants_with_operator
    await _login(web_client, data["operator_a"].email, data["operator_a_password"])

    response = await web_client.get("/backoffice/tenants")
    assert response.status_code == 403


async def test_unauthenticated_request_redirects_to_login(web_client, real_auth):
    response = await web_client.get("/web/occurrences", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/web/login"


async def test_authenticate_user_rejects_inactive_user(db_session):
    user = User(
        email=f"inativo-{uuid.uuid4().hex[:8]}@teste.com",
        password_hash=hash_password("senha12345"),
        is_platform_admin=True,
        is_active=False,
    )
    db_session.add(user)
    await db_session.flush()

    result = await authenticate_user(db_session, user.email, "senha12345")
    assert result is None


async def test_create_tenant_operator_rejects_duplicate_email(db_session):
    tenant = Tenant(
        name="Tenant Dup Teste", slug=f"tenant-dup-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-dup-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    email = f"dup-{uuid.uuid4().hex[:8]}@teste.com"
    await create_tenant_operator(db_session, tenant_id=tenant.id, email=email, password="senha12345")

    with pytest.raises(DuplicateEmailError):
        await create_tenant_operator(db_session, tenant_id=tenant.id, email=email, password="outrasenha")


async def test_create_tenant_operator_normalizes_and_deduplicates_email_case(db_session):
    tenant = Tenant(
        name="Tenant Case Teste", slug=f"tenant-case-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-case-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    email = f"Case-{uuid.uuid4().hex[:8]}@Teste.COM"
    user = await create_tenant_operator(db_session, tenant_id=tenant.id, email=email, password="senha12345")
    assert user.email == email.strip().lower()

    with pytest.raises(DuplicateEmailError):
        await create_tenant_operator(
            db_session, tenant_id=tenant.id, email=email.upper(), password="outrasenha"
        )


async def test_delete_user_removes_the_row(db_session):
    tenant = Tenant(
        name="Tenant Delete Teste", slug=f"tenant-delete-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-delete-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    user = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"apagar-{uuid.uuid4().hex[:8]}@teste.com", password="senha12345"
    )
    user_id = user.id

    await delete_user(db_session, user)
    await db_session.flush()

    assert await db_session.get(User, user_id) is None


@pytest.fixture
async def tenant_with_platform_admin_and_operator(real_auth):
    """Como two_tenants_with_operator, mas com um admin da plataforma de
    verdade também — necessário pra testar a rota de remoção de operador
    no backoffice, que só admin da plataforma acessa."""
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Tenant Backoffice Delete Teste", slug=f"tenant-bo-delete-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-bo-delete-{uuid.uuid4().hex[:8]}", evolution_token="tok",
        )
        db.add(tenant)
        await db.flush()

        admin_password = "senha-admin-bo-123"
        admin = User(
            tenant_id=None, email=f"admin-bo-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(admin_password), is_platform_admin=True,
        )
        operator_password = "senha-operador-bo-123"
        operator = User(
            tenant_id=tenant.id, email=f"operador-bo-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(operator_password), is_platform_admin=False,
        )
        db.add_all([admin, operator])
        await db.commit()
        for obj in (tenant, admin, operator):
            await db.refresh(obj)

        yield {
            "tenant": tenant, "admin": admin, "admin_password": admin_password,
            "operator": operator, "operator_password": operator_password,
        }

        await db.delete(admin)
        await db.commit()
        await db.delete(tenant)
        await db.commit()


async def test_backoffice_delete_operator_route_removes_user(
    web_client, tenant_with_platform_admin_and_operator
):
    data = tenant_with_platform_admin_and_operator
    await _login(web_client, data["admin"].email, data["admin_password"])

    response = await web_client.post(
        f"/backoffice/tenants/{data['tenant'].id}/users/{data['operator'].id}/delete",
        follow_redirects=False,
    )
    assert response.status_code == 303

    async with AsyncSessionLocal() as db:
        assert await db.get(User, data["operator"].id) is None

    # login com a conta apagada precisa falhar (não sobrou credencial nenhuma)
    login_response = await _login(web_client, data["operator"].email, data["operator_password"])
    assert login_response.status_code == 401


async def test_backoffice_delete_operator_route_requires_platform_admin(
    web_client, tenant_with_platform_admin_and_operator
):
    data = tenant_with_platform_admin_and_operator
    await _login(web_client, data["operator"].email, data["operator_password"])

    response = await web_client.post(
        f"/backoffice/tenants/{data['tenant'].id}/users/{data['operator'].id}/delete"
    )
    assert response.status_code == 403

    async with AsyncSessionLocal() as db:
        assert await db.get(User, data["operator"].id) is not None


async def test_set_user_password_updates_hash(db_session):
    from app.core.security import verify_password
    from app.services.user_service import set_user_password

    tenant = Tenant(
        name="Tenant Senha Teste", slug=f"tenant-senha-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-senha-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    user = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"senha-{uuid.uuid4().hex[:8]}@teste.com", password="senhaantiga123"
    )

    await set_user_password(db_session, user, "senhanova123")
    assert verify_password("senhanova123", user.password_hash)
    assert not verify_password("senhaantiga123", user.password_hash)


async def test_change_password_requires_correct_current_password(web_client, two_tenants_with_operator):
    data = two_tenants_with_operator
    await _login(web_client, data["operator_a"].email, data["operator_a_password"])

    response = await web_client.post(
        "/web/change-password",
        data={
            "current_password": "senha-errada", "new_password": "senhanova123",
            "confirm_password": "senhanova123",
        },
    )
    assert response.status_code == 400
    assert "incorreta" in response.text


async def test_change_password_requires_matching_confirmation(web_client, two_tenants_with_operator):
    data = two_tenants_with_operator
    await _login(web_client, data["operator_a"].email, data["operator_a_password"])

    response = await web_client.post(
        "/web/change-password",
        data={
            "current_password": data["operator_a_password"], "new_password": "senhanova123",
            "confirm_password": "outracoisaqualquer",
        },
    )
    assert response.status_code == 400
    assert "coincidem" in response.text


async def test_change_password_succeeds_and_updates_login(web_client, two_tenants_with_operator):
    data = two_tenants_with_operator
    await _login(web_client, data["operator_a"].email, data["operator_a_password"])

    response = await web_client.post(
        "/web/change-password",
        data={
            "current_password": data["operator_a_password"], "new_password": "senhabemnova123",
            "confirm_password": "senhabemnova123",
        },
    )
    assert response.status_code == 200
    assert "sucesso" in response.text

    old_login = await _login(web_client, data["operator_a"].email, data["operator_a_password"])
    assert old_login.status_code == 401

    new_login = await _login(web_client, data["operator_a"].email, "senhabemnova123")
    assert new_login.status_code == 303


async def test_backoffice_reset_password_updates_login(
    web_client, tenant_with_platform_admin_and_operator
):
    data = tenant_with_platform_admin_and_operator
    await _login(web_client, data["admin"].email, data["admin_password"])

    response = await web_client.post(
        f"/backoffice/tenants/{data['tenant'].id}/users/{data['operator'].id}/reset-password",
        data={"new_password": "senharesetada123"},
        follow_redirects=False,
    )
    assert response.status_code == 303

    old_login = await _login(web_client, data["operator"].email, data["operator_password"])
    assert old_login.status_code == 401

    new_login = await _login(web_client, data["operator"].email, "senharesetada123")
    assert new_login.status_code == 303
