"""
Testes de arquivamento e filtros do histórico de chamadas (app.web.routes).
archive_occurrence/unarchive_occurrence são puramente visuais — nunca mexem
em Occurrence.state — então os testes de serviço usam db_session
(rollback-only). Os testes de rota HTTP precisam de dado commitado de
verdade (o web_client abre sua própria sessão contra o banco), limpo no
teardown.
"""
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.db.models.enums import OccurrenceState
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.db.session import AsyncSessionLocal
from app.main import app
from app.services.occurrence_service import archive_occurrence, unarchive_occurrence


async def _make_tenant(db_session) -> Tenant:
    tenant = Tenant(
        name="Tenant Arquivamento Teste", slug=f"tenant-arquivo-{uuid.uuid4().hex[:8]}",
        evolution_instance=f"inst-arquivo-{uuid.uuid4().hex[:8]}", evolution_token="tok",
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def _make_occurrence(db_session, tenant: Tenant, **overrides) -> Occurrence:
    occurrence = Occurrence(tenant_id=tenant.id, driver_phone="5511900000001", **overrides)
    db_session.add(occurrence)
    await db_session.flush()
    return occurrence


async def test_archive_occurrence_sets_archived_at_without_changing_state(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_occurrence(db_session, tenant)

    assert occurrence.archived_at is None
    original_state = occurrence.state

    await archive_occurrence(db_session, occurrence)

    assert occurrence.archived_at is not None
    assert occurrence.state == original_state


async def test_unarchive_occurrence_clears_archived_at(db_session):
    tenant = await _make_tenant(db_session)
    occurrence = await _make_occurrence(db_session, tenant)

    await archive_occurrence(db_session, occurrence)
    assert occurrence.archived_at is not None

    await unarchive_occurrence(db_session, occurrence)
    assert occurrence.archived_at is None


@pytest.fixture
async def web_client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
async def committed_occurrences():
    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Tenant Arquivo HTTP Teste", slug=f"tenant-arquivo-http-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-arquivo-http-{uuid.uuid4().hex[:8]}", evolution_token="tok",
        )
        db.add(tenant)
        await db.flush()

        recent = Occurrence(
            tenant_id=tenant.id, driver_phone="5511900000011",
            created_at=datetime.now(timezone.utc),
        )
        old = Occurrence(
            tenant_id=tenant.id, driver_phone="5511900000012",
            created_at=datetime.now(timezone.utc) - timedelta(days=30),
        )
        db.add_all([recent, old])
        await db.commit()
        for obj in (tenant, recent, old):
            await db.refresh(obj)

        yield {"tenant": tenant, "recent": recent, "old": old}

        await db.delete(recent)
        await db.delete(old)
        await db.commit()
        await db.delete(tenant)
        await db.commit()


async def test_occurrences_list_hides_archived_by_default(web_client, committed_occurrences):
    data = committed_occurrences
    response = await web_client.post(
        f"/web/occurrences/{data['recent'].id}/archive", follow_redirects=False
    )
    assert response.status_code == 303

    response = await web_client.get("/web/occurrences")
    assert data["recent"].driver_phone not in response.text
    assert data["old"].driver_phone in response.text

    # limpa o estado pro teardown do fixture não achar nada estranho
    await web_client.post(f"/web/occurrences/{data['recent'].id}/unarchive")


async def test_occurrences_list_show_archived_includes_them(web_client, committed_occurrences):
    data = committed_occurrences
    await web_client.post(f"/web/occurrences/{data['recent'].id}/archive")

    response = await web_client.get("/web/occurrences", params={"show_archived": "true"})
    assert data["recent"].driver_phone in response.text

    await web_client.post(f"/web/occurrences/{data['recent'].id}/unarchive")


async def test_occurrences_list_date_filter_excludes_old_occurrence(web_client, committed_occurrences):
    data = committed_occurrences
    date_from = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()

    response = await web_client.get("/web/occurrences", params={"date_from": date_from})
    assert data["recent"].driver_phone in response.text
    assert data["old"].driver_phone not in response.text


async def _current_badge_count(web_client) -> int:
    response = await web_client.get("/web/escalations/count-badge")
    assert response.status_code == 200
    marker = 'data-count="'
    start = response.text.index(marker) + len(marker)
    end = response.text.index('"', start)
    return int(response.text[start:end])


async def test_escalations_count_badge_reflects_open_escalations(web_client):
    before = await _current_badge_count(web_client)

    async with AsyncSessionLocal() as db:
        tenant = Tenant(
            name="Tenant Badge Teste", slug=f"tenant-badge-{uuid.uuid4().hex[:8]}",
            evolution_instance=f"inst-badge-{uuid.uuid4().hex[:8]}", evolution_token="tok",
        )
        db.add(tenant)
        await db.flush()
        occurrence = Occurrence(
            tenant_id=tenant.id, driver_phone="5511900000088", state=OccurrenceState.ESCALATED_TO_HUMAN,
        )
        db.add(occurrence)
        await db.commit()
        await db.refresh(tenant)
        await db.refresh(occurrence)

    try:
        during = await _current_badge_count(web_client)
        assert during == before + 1
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(
                Occurrence.__table__.delete().where(Occurrence.id == occurrence.id)
            )
            await db.commit()
            await db.execute(Tenant.__table__.delete().where(Tenant.id == tenant.id))
            await db.commit()

    after = await _current_badge_count(web_client)
    assert after == before
