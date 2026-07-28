"""
Regressão: quando o relato do motorista escala pra humano na classificação
(áudio sem transcrição, ou IA sem confiança), o motorista precisa receber
um aviso — antes ficava no vácuo, sem nenhuma resposta. Aqui usamos um
cliente evolution-go falso (captura os envios, sem rede) e um tenant com o
template DRIVER_REPORT_ESCALATED_NOTICE configurado.
"""
import uuid

import pytest

from app.core.config import get_settings
from app.db.models.enums import MessageContentType, OccurrenceState
from app.db.models.tenant import Tenant
from app.integrations.evolution_api.webhook_parser import ParsedInboundMessage
from app.services import occurrence_service


class _FakeEvolutionClient:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send_text(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net"}}}

    async def send_text_resolved(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net"}}}, None


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-escalate-notice-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Aviso Escalação", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={
            "driver_report_escalated_notice": "Recebemos seu relato, um atendente vai analisar.",
        },
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


def _audio_message() -> ParsedInboundMessage:
    return ParsedInboundMessage(
        instance_name="inst", phone="5511900000123",
        content_type=MessageContentType.AUDIO, content_text=None,
        audio_url="http://x/audio.ogg", external_message_id=f"ext-{uuid.uuid4().hex[:8]}",
        raw_payload={},
    )


async def test_audio_report_escalates_and_notifies_driver(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    fake = _FakeEvolutionClient()
    monkeypatch.setattr(occurrence_service, "evolution_client_for", lambda t, s: fake)

    occurrence = await occurrence_service.handle_driver_report(
        db_session, get_settings(), tenant, _audio_message()
    )

    assert occurrence.state == OccurrenceState.ESCALATED_TO_HUMAN
    assert len(fake.sent) == 1
    phone, text = fake.sent[0]
    assert phone == "5511900000123"
    assert "atendente" in text


async def test_audio_report_without_template_stays_silent_but_escalates(db_session, monkeypatch):
    """Sem o template configurado, nada é enviado (comportamento padrão do
    render_template) — mas a escalação em si continua acontecendo."""
    tenant = await _make_tenant(db_session)
    tenant.message_templates = {}
    fake = _FakeEvolutionClient()
    monkeypatch.setattr(occurrence_service, "evolution_client_for", lambda t, s: fake)

    occurrence = await occurrence_service.handle_driver_report(
        db_session, get_settings(), tenant, _audio_message()
    )

    assert occurrence.state == OccurrenceState.ESCALATED_TO_HUMAN
    assert fake.sent == []
