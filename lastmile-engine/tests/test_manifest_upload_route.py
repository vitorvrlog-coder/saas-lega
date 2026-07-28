"""
Teste HTTP real (não rollback) de /web/manifests/new — primeira rota do
projeto usando upload de arquivo (UploadFile). real_auth desliga o bypass
de dev (que loga como admin de plataforma fantasma sem tenant, e essa rota
exige require_tenant_admin) — ver tests/test_tenant_admin.py pro mesmo
padrão de login real.
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
async def tenant_with_admin(real_auth):
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Tenant Planilha Rota", slug=f"tenant-manifest-route-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-manifest-{uuid.uuid4().hex[:8]}", evolution_token="tok",
        )
        db.add(tenant)
        await db.flush()

        password = "senha-admin-planilha-123"
        admin = User(
            tenant_id=tenant.id,
            email=f"admin-planilha-{uuid.uuid4().hex[:8]}@teste.com",
            password_hash=hash_password(password),
            is_platform_admin=False, is_tenant_admin=True,
        )
        db.add(admin)
        await db.commit()
        await db.refresh(tenant)
        await db.refresh(admin)

        yield {"tenant": tenant, "admin": admin, "password": password}

        # RouteManifest tem ondelete="RESTRICT" pro tenant (mesma convenção
        # de Occurrence — nunca apagar tenant com dado real por engano), por
        # isso limpa manifestos criados pelo próprio teste antes do tenant.
        from sqlalchemy import delete

        from app.db.models.route_manifest import RouteManifest

        await db.execute(delete(RouteManifest).where(RouteManifest.tenant_id == tenant.id))
        await db.delete(admin)
        await db.delete(tenant)
        await db.commit()


async def _login(web_client: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    return await web_client.post(
        "/web/login", data={"email": email, "password": password}, follow_redirects=False
    )


async def test_upload_valid_csv_redirects_to_manifest_detail(web_client, tenant_with_admin):
    data = tenant_with_admin
    await _login(web_client, data["admin"].email, data["password"])

    csv_content = (
        b"stop_number,driver_phone,customer_name,customer_phone,address,route_id\n"
        b"1,47999998888,Maria,47988887777,Rua A 123,ROTA-1\n"
    )

    response = await web_client.post(
        "/web/manifests/new",
        data={"route_date": "2026-07-08"},
        files={"file": ("rota.csv", csv_content, "text/csv")},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"].startswith("/web/manifests/")


async def test_upload_missing_column_shows_friendly_error(web_client, tenant_with_admin):
    data = tenant_with_admin
    await _login(web_client, data["admin"].email, data["password"])

    csv_content = b"stop_number,driver_phone\n1,47999998888\n"

    response = await web_client.post(
        "/web/manifests/new",
        data={"route_date": "2026-07-08"},
        files={"file": ("rota.csv", csv_content, "text/csv")},
    )

    assert response.status_code == 200
    assert "obrigat" in response.text


async def test_plain_operator_cannot_upload_manifest(web_client, tenant_with_admin):
    """Só admin de tenant pode importar planilha — operador comum não."""
    from app.services.user_service import create_tenant_operator

    data = tenant_with_admin
    async with AsyncSessionLocal() as db:
        operator = await create_tenant_operator(
            db, tenant_id=data["tenant"].id,
            email=f"operador-planilha-{uuid.uuid4().hex[:8]}@teste.com",
            password="senha-operador-123",
        )
        await db.commit()
        await db.refresh(operator)

    await _login(web_client, operator.email, "senha-operador-123")

    response = await web_client.get("/web/manifests/new")
    assert response.status_code == 403

    async with AsyncSessionLocal() as db:
        await db.delete(await db.get(User, operator.id))
        await db.commit()
