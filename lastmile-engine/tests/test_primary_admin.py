"""
Testes do papel "admin principal" (no máximo 1 por tenant, controle total
sobre os outros admins do próprio tenant — diferente do admin de tenant
comum, que só gerencia operadores não-admin). Reaproveita os fixtures e
convenções de test_tenant_admin.py (real_auth, web_client, dados commitados
de verdade)."""
import uuid

import httpx
import pytest
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import AsyncSessionLocal
from app.main import app
from app.services.user_service import create_tenant_operator, set_primary_admin


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
async def tenant_with_primary_admin_and_others(real_auth):
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Tenant Admin Principal Teste", slug=f"tenant-primary-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-primary-{uuid.uuid4().hex[:8]}", evolution_token="tok",
        )
        db.add(tenant)
        await db.flush()

        primary_password = "senha-admin-principal-123"
        primary_admin = User(
            tenant_id=tenant.id,
            email=f"admin-principal-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(primary_password),
            is_platform_admin=False, is_tenant_admin=True, is_primary_admin=True,
        )
        regular_password = "senha-admin-comum-123"
        regular_admin = User(
            tenant_id=tenant.id,
            email=f"admin-comum-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(regular_password),
            is_platform_admin=False, is_tenant_admin=True,
        )
        plain_password = "senha-operador-comum-123"
        plain_operator = User(
            tenant_id=tenant.id,
            email=f"operador-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(plain_password),
            is_platform_admin=False, is_tenant_admin=False,
        )
        db.add_all([primary_admin, regular_admin, plain_operator])
        await db.commit()
        for obj in (tenant, primary_admin, regular_admin, plain_operator):
            await db.refresh(obj)

        yield {
            "tenant": tenant,
            "primary_admin": primary_admin, "primary_admin_password": primary_password,
            "regular_admin": regular_admin, "regular_admin_password": regular_password,
            "plain_operator": plain_operator, "plain_operator_password": plain_password,
        }

        await db.delete(tenant)
        await db.commit()


async def _login(web_client: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    return await web_client.post(
        "/web/login", data={"email": email, "password": password}, follow_redirects=False
    )


async def test_set_primary_admin_forces_tenant_admin(db_session):
    tenant = Tenant(
        name="Tenant Set Primary Teste", slug=f"tenant-set-primary-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-set-primary-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    user = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"op-{uuid.uuid4().hex[:8]}@teste.com", password="senha12345"
    )
    assert user.is_tenant_admin is False

    await set_primary_admin(db_session, user, True)
    assert user.is_primary_admin is True
    assert user.is_tenant_admin is True


async def test_set_primary_admin_demotes_previous_holder(db_session):
    tenant = Tenant(
        name="Tenant Demote Teste", slug=f"tenant-demote-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-demote-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    first = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"op1-{uuid.uuid4().hex[:8]}@teste.com", password="senha12345"
    )
    second = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"op2-{uuid.uuid4().hex[:8]}@teste.com", password="senha12345"
    )

    await set_primary_admin(db_session, first, True)
    assert first.is_primary_admin is True

    await set_primary_admin(db_session, second, True)
    assert second.is_primary_admin is True
    assert first.is_primary_admin is False


async def test_set_primary_admin_demote_does_not_touch_tenant_admin(db_session):
    tenant = Tenant(
        name="Tenant Demote Sem Cascata Teste", slug=f"tenant-demote-cascata-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-demote-cascata-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    user = await create_tenant_operator(
        db_session, tenant_id=tenant.id, email=f"op-{uuid.uuid4().hex[:8]}@teste.com", password="senha12345"
    )
    await set_primary_admin(db_session, user, True)
    assert user.is_tenant_admin is True

    await set_primary_admin(db_session, user, False)
    assert user.is_primary_admin is False
    assert user.is_tenant_admin is True  # não cascateia de volta


async def test_only_one_primary_admin_per_tenant_at_db_level(db_session):
    tenant = Tenant(
        name="Tenant Constraint Teste", slug=f"tenant-constraint-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-constraint-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()

    user_a = User(
        tenant_id=tenant.id, email=f"a-{uuid.uuid4().hex[:8]}@teste.com",
        password_hash=hash_password("senha12345"),
        is_tenant_admin=True, is_primary_admin=True,
    )
    user_b = User(
        tenant_id=tenant.id, email=f"b-{uuid.uuid4().hex[:8]}@teste.com",
        password_hash=hash_password("senha12345"),
        is_tenant_admin=True, is_primary_admin=True,
    )
    db_session.add_all([user_a, user_b])
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_regular_admin_blocked_from_toggling_active_on_other_admin(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    await _login(web_client, data["regular_admin"].email, data["regular_admin_password"])

    target = data["primary_admin"]
    response = await web_client.post(f"/web/my-tenant/operators/{target.id}/toggle-active")
    assert response.status_code == 403
    assert "admin principal" in response.text.lower()

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, target.id)
        assert refreshed.is_active == target.is_active


async def test_primary_admin_can_toggle_active_on_regular_admin(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    await _login(web_client, data["primary_admin"].email, data["primary_admin_password"])

    target = data["regular_admin"]
    response = await web_client.post(f"/web/my-tenant/operators/{target.id}/toggle-active", follow_redirects=False)
    assert response.status_code == 303

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, target.id)
        assert refreshed.is_active != target.is_active


async def test_regular_admin_blocked_from_toggle_tenant_admin_route(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    await _login(web_client, data["regular_admin"].email, data["regular_admin_password"])

    target = data["plain_operator"]
    response = await web_client.post(f"/web/my-tenant/operators/{target.id}/toggle-tenant-admin")
    assert response.status_code == 403

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, target.id)
        assert refreshed.is_tenant_admin is False


async def test_primary_admin_can_promote_operator_via_dashboard(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    await _login(web_client, data["primary_admin"].email, data["primary_admin_password"])

    target = data["plain_operator"]
    response = await web_client.post(
        f"/web/my-tenant/operators/{target.id}/toggle-tenant-admin", follow_redirects=False
    )
    assert response.status_code == 303

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, target.id)
        assert refreshed.is_tenant_admin is True


async def test_primary_admin_cannot_self_demote_via_dashboard(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    admin = data["primary_admin"]
    await _login(web_client, admin.email, data["primary_admin_password"])

    response = await web_client.post(f"/web/my-tenant/operators/{admin.id}/toggle-tenant-admin")
    assert response.status_code == 403

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, admin.id)
        assert refreshed.is_primary_admin is True
        assert refreshed.is_tenant_admin is True


async def test_primary_admin_cannot_self_delete_via_dashboard(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    admin = data["primary_admin"]
    await _login(web_client, admin.email, data["primary_admin_password"])

    response = await web_client.post(f"/web/my-tenant/operators/{admin.id}/delete")
    assert response.status_code == 403

    async with AsyncSessionLocal() as db:
        assert await db.get(User, admin.id) is not None


async def test_regular_admin_blocked_from_delete_route(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    await _login(web_client, data["regular_admin"].email, data["regular_admin_password"])

    target = data["plain_operator"]
    response = await web_client.post(f"/web/my-tenant/operators/{target.id}/delete")
    assert response.status_code == 403

    async with AsyncSessionLocal() as db:
        assert await db.get(User, target.id) is not None


async def test_primary_admin_can_delete_regular_operator(
    web_client, tenant_with_primary_admin_and_others
):
    data = tenant_with_primary_admin_and_others
    await _login(web_client, data["primary_admin"].email, data["primary_admin_password"])

    target = data["plain_operator"]
    response = await web_client.post(f"/web/my-tenant/operators/{target.id}/delete", follow_redirects=False)
    assert response.status_code == 303

    async with AsyncSessionLocal() as db:
        assert await db.get(User, target.id) is None


async def test_backoffice_toggle_primary_admin_demotes_old_and_promotes_new(
    web_client, tenant_with_primary_admin_and_others
):
    from app.db.models.user import User as UserModel

    data = tenant_with_primary_admin_and_others
    async with AsyncSessionLocal() as db:
        platform_admin = UserModel(
            tenant_id=None, email=f"plat-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password("senhaplataforma123"), is_platform_admin=True,
        )
        db.add(platform_admin)
        await db.commit()
        await db.refresh(platform_admin)

    try:
        await _login(web_client, platform_admin.email, "senhaplataforma123")

        old_primary = data["primary_admin"]
        new_primary = data["regular_admin"]
        response = await web_client.post(
            f"/backoffice/tenants/{data['tenant'].id}/users/{new_primary.id}/toggle-primary-admin",
            follow_redirects=False,
        )
        assert response.status_code == 303

        async with AsyncSessionLocal() as db:
            refreshed_new = await db.get(User, new_primary.id)
            refreshed_old = await db.get(User, old_primary.id)
            assert refreshed_new.is_primary_admin is True
            assert refreshed_new.is_tenant_admin is True
            assert refreshed_old.is_primary_admin is False
    finally:
        async with AsyncSessionLocal() as db:
            await db.delete(await db.get(UserModel, platform_admin.id))
            await db.commit()


async def test_any_user_can_update_own_profile(web_client, tenant_with_primary_admin_and_others):
    data = tenant_with_primary_admin_and_others
    await _login(web_client, data["plain_operator"].email, data["plain_operator_password"])

    response = await web_client.post(
        "/web/my-profile", data={"name": "Fulano de Tal", "phone": "47999998888"}, follow_redirects=False
    )
    assert response.status_code == 200

    async with AsyncSessionLocal() as db:
        refreshed = await db.get(User, data["plain_operator"].id)
        assert refreshed.name == "Fulano de Tal"
        assert refreshed.phone == "47999998888"
