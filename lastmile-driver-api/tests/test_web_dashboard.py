import httpx
import pytest

from app.main import app


@pytest.fixture
async def web_client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def test_dashboard_home_renders_with_stats(web_client):
    response = await web_client.get("/web/")
    assert response.status_code == 200
    assert "Visão geral" in response.text
    assert "Aguardando fila humana" in response.text


async def test_human_queue_page_renders(web_client):
    response = await web_client.get("/web/human-queue")
    assert response.status_code == 200
    assert "Chamadas" in response.text


async def test_occurrences_page_renders(web_client):
    response = await web_client.get("/web/occurrences")
    assert response.status_code == 200
    assert "Histórico de chamadas" in response.text


async def test_login_page_renders(web_client):
    response = await web_client.get("/web/login")
    assert response.status_code == 200
    assert "E-mail" in response.text


async def test_unknown_occurrence_detail_redirects_to_list(web_client):
    response = await web_client.get(
        "/web/occurrences/00000000-0000-0000-0000-000000000000", follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/web/occurrences"


async def test_backoffice_overview_page_renders(web_client):
    response = await web_client.get("/backoffice/")
    assert response.status_code == 200
    assert "Transportadoras ativas" in response.text


async def test_backoffice_tenants_list_page_renders(web_client):
    response = await web_client.get("/backoffice/tenants")
    assert response.status_code == 200
    assert "Transportadoras" in response.text


async def test_backoffice_tenant_new_form_renders(web_client):
    response = await web_client.get("/backoffice/tenants/new")
    assert response.status_code == 200
    assert "Nova transportadora" in response.text


async def test_unknown_tenant_detail_redirects_to_list(web_client):
    response = await web_client.get(
        "/backoffice/tenants/00000000-0000-0000-0000-000000000000", follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/backoffice/tenants"


async def test_tenant_new_submit_without_global_api_key_shows_error(web_client, monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "EVOLUTION_GLOBAL_API_KEY", None)

    response = await web_client.post(
        "/backoffice/tenants/new",
        data={
            "name": "Tenant sem chave via web",
            "slug": "tenant-sem-chave-web-teste",
            "allowed_radius_km": "2.0",
            "timeout_attempt_1_minutes": "30",
            "timeout_attempt_2_minutes": "60",
        },
    )
    assert response.status_code == 400
    assert "EVOLUTION_GLOBAL_API_KEY" in response.text


async def test_escalations_list_page_renders(web_client):
    response = await web_client.get("/web/escalations")
    assert response.status_code == 200
    assert "Escalações" in response.text


async def test_unknown_escalation_detail_redirects_to_list(web_client):
    response = await web_client.get(
        "/web/escalations/00000000-0000-0000-0000-000000000000", follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/web/escalations"


@pytest.fixture
async def committed_tenant_and_occurrence():
    """Tenant + ocorrência commitados de verdade (não rollback-only) — o
    web_client faz requisições HTTP reais contra app.main.app, que abre sua
    própria sessão de banco por requisição."""
    import uuid

    from app.db.models.enums import OccurrenceState
    from app.db.models.occurrence import Occurrence
    from app.db.models.tenant import Tenant
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Tenant Teste Falha Envio", slug=f"tenant-falha-envio-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-falha-{uuid.uuid4().hex[:8]}", evolution_token="tok",
        )
        db.add(tenant)
        await db.flush()
        occurrence = Occurrence(
            tenant_id=tenant.id, driver_phone="5511900000000",
            state=OccurrenceState.PENDING_HUMAN_QUEUE,
        )
        db.add(occurrence)
        await db.commit()
        await db.refresh(tenant)
        await db.refresh(occurrence)

        yield tenant, occurrence

        await db.delete(occurrence)
        await db.delete(tenant)
        await db.commit()


async def test_human_queue_submit_shows_friendly_error_when_whatsapp_send_fails(
    web_client, committed_tenant_and_occurrence, monkeypatch
):
    """Regressão: uma falha de envio (ex: erro 463 do WhatsApp, mesmo após
    o retry do EvolutionClient) virava tela de erro 500 crua em vez de uma
    mensagem que o operador entende e pode tentar de novo."""
    from app.integrations.evolution_api.client import EvolutionAPIError

    tenant, occurrence = committed_tenant_and_occurrence

    async def fake_send_contact_attempt(*args, **kwargs):
        raise EvolutionAPIError(500, '{"error":"server returned error 463"}')

    monkeypatch.setattr("app.web.routes.send_contact_attempt", fake_send_contact_attempt)

    response = await web_client.post(
        f"/web/human-queue/{occurrence.id}",
        data={
            "route_id": "ROTA-1", "customer_name": "Cliente Teste",
            "customer_phone": "5511911111111", "original_address": "Rua Teste, 1",
        },
    )

    assert response.status_code == 200
    assert "Falha ao enviar mensagem" in response.text
    assert "Internal Server Error" not in response.text
