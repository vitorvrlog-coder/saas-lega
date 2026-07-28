"""
Regressão: um motorista comentando numa ocorrência já aberta ("ok",
"tranquilo", "valeu") estava sendo tratado como um relato NOVO de
insucesso — reclassificado pela IA e reiniciando a cascata de avisos
inteira. Confirmado em produção: um motorista mandando respostas casuais
gerava várias ocorrências separadas em minutos, cada uma reenviando
"Recebi seu relato!" e companhia. handle_inbound_message agora checa se
já existe uma ocorrência em andamento pra esse motorista antes de tratar
a mensagem como relato novo.
"""
import uuid

import pytest

from app.core.config import get_settings
from app.db.models.enums import MessageContentType, OccurrenceState
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.integrations.evolution_api.webhook_parser import ParsedInboundMessage
from app.services import occurrence_service


class _FakeEvolutionClient:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send_text(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net", "ID": f"id-{len(self.sent)}"}}}

    async def send_text_resolved(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net"}}}, None


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-followup-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Followup", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={
            "driver_report_received_notice": "Recebi seu relato!",
            "driver_followup_ack": "👍",
        },
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


def _driver_message(phone: str, text: str) -> ParsedInboundMessage:
    return ParsedInboundMessage(
        instance_name="inst", phone=phone,
        content_type=MessageContentType.TEXT, content_text=text,
        audio_url=None, external_message_id=f"ext-{uuid.uuid4().hex[:8]}",
        raw_payload={},
    )


async def test_followup_message_does_not_create_new_occurrence(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    occurrence = Occurrence(
        tenant_id=tenant.id, driver_phone="5511900000999",
        state=OccurrenceState.PENDING_HUMAN_QUEUE,
    )
    db_session.add(occurrence)
    await db_session.flush()

    fake = _FakeEvolutionClient()
    monkeypatch.setattr(occurrence_service, "evolution_client_for", lambda t, s: fake)

    result = await occurrence_service.handle_inbound_message(
        db_session, get_settings(), tenant, _driver_message("5511900000999", "ok, estou no aguardo")
    )

    assert result.id == occurrence.id
    assert result.state == OccurrenceState.PENDING_HUMAN_QUEUE
    # Só o aviso curto de confirmação, NUNCA o "Recebi seu relato!" de novo.
    assert len(fake.sent) == 1
    assert fake.sent[0][1] == "👍"


async def test_followup_ack_sent_only_once_per_occurrence(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    occurrence = Occurrence(
        tenant_id=tenant.id, driver_phone="5511900000998",
        state=OccurrenceState.PENDING_HUMAN_QUEUE,
    )
    db_session.add(occurrence)
    await db_session.flush()

    fake = _FakeEvolutionClient()
    monkeypatch.setattr(occurrence_service, "evolution_client_for", lambda t, s: fake)

    await occurrence_service.handle_inbound_message(
        db_session, get_settings(), tenant, _driver_message("5511900000998", "ok")
    )
    await occurrence_service.handle_inbound_message(
        db_session, get_settings(), tenant, _driver_message("5511900000998", "tranquilo")
    )

    assert len(fake.sent) == 1
    assert occurrence.driver_followup_acked is True


async def test_closed_occurrence_does_not_block_new_report(db_session):
    """Ocorrência já fechada não deve ser encontrada como "em andamento"
    (ver _TERMINAL_STATES) — senão um relato genuinamente novo do mesmo
    motorista, depois de um anterior já resolvido, seria incorretamente
    tratado como comentário de acompanhamento."""
    tenant = await _make_tenant(db_session)
    closed = Occurrence(
        tenant_id=tenant.id, driver_phone="5511900000997",
        state=OccurrenceState.CLOSED_RESOLVED,
    )
    open_one = Occurrence(
        tenant_id=tenant.id, driver_phone="5511900000996",
        state=OccurrenceState.AWAITING_CUSTOMER_REPLY_1,
    )
    db_session.add_all([closed, open_one])
    await db_session.flush()

    assert await occurrence_service.find_open_occurrence_for_driver(
        db_session, tenant.id, "5511900000997"
    ) is None
    found = await occurrence_service.find_open_occurrence_for_driver(
        db_session, tenant.id, "5511900000996"
    )
    assert found is not None and found.id == open_one.id
