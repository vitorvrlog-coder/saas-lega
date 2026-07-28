"""
Regressão do gancho novo em occurrence_service.handle_driver_report: quando
o motorista relata insucesso sem telefone/endereço do cliente mas cita um
número de parada, e existe uma planilha de rota importada com aquele
(driver_phone, stop_number), a ocorrência deve pular a fila humana e ir
direto pra contato com o cliente — mesmo efeito que fill_human_queue
produziria manualmente.
"""
import datetime
import json
import uuid

import pytest

from app.ai.base import AIProvider
from app.core.config import get_settings
from app.db.models.enums import MessageContentType, OccurrenceState
from app.db.models.tenant import Tenant
from app.integrations.evolution_api.webhook_parser import ParsedInboundMessage
from app.services import occurrence_service
from app.services.manifest_service import parse_manifest_file, store_manifest

CSV_HEADER = "stop_number,driver_phone,customer_name,customer_phone,address,route_id\n"


class _FakeEvolutionClient:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send_text(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net", "ID": f"id-{len(self.sent)}"}}}

    async def send_text_resolved(self, phone: str, text: str):
        self.sent.append((phone, text))
        return {"data": {"Info": {"Chat": f"{phone}@s.whatsapp.net"}}}, None


class _FakeAIProvider(AIProvider):
    def __init__(self, output: dict):
        self.provider_name = "fake"
        self.model_name = "fake-model"
        self._output = output

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        return json.dumps(self._output)


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-manifest-hook-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Gancho Planilha", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={},
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


def _classification_output(stop_number: str | None) -> dict:
    return {
        "failure_reason": "absent",
        "requires_customer_contact": True,
        "customer_phone": None,
        "original_address": None,
        "stop_number": stop_number,
        "confidence": 0.9,
        "is_ambiguous": False,
        "reasoning": "motorista relatou cliente ausente",
    }


async def test_stop_number_with_manifest_match_skips_human_queue(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    rows = parse_manifest_file(
        (CSV_HEADER + "7,5511900000111,Maria,5511911112222,Rua das Flores 10,ROTA-9\n").encode("utf-8"),
        "rota.csv",
    )
    await store_manifest(db_session, tenant.id, None, "rota.csv", datetime.date.today(), rows)

    fake_client = _FakeEvolutionClient()
    monkeypatch.setattr(occurrence_service, "evolution_client_for", lambda t, s: fake_client)
    monkeypatch.setattr(
        occurrence_service, "get_ai_provider",
        lambda settings: _FakeAIProvider(_classification_output("7")),
    )

    occurrence = await occurrence_service.handle_driver_report(
        db_session, get_settings(), tenant, _driver_message("5511900000111", "parada 7, cliente ausente")
    )

    assert occurrence.state == OccurrenceState.AWAITING_CUSTOMER_REPLY_1
    assert occurrence.customer_phone == "5511911112222"
    assert occurrence.original_address == "Rua das Flores 10"
    assert occurrence.customer_name == "Maria"
    assert occurrence.route_id == "ROTA-9"


async def test_stop_number_without_manifest_falls_back_to_human_queue(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    fake_client = _FakeEvolutionClient()
    monkeypatch.setattr(occurrence_service, "evolution_client_for", lambda t, s: fake_client)
    monkeypatch.setattr(
        occurrence_service, "get_ai_provider",
        lambda settings: _FakeAIProvider(_classification_output("42")),
    )

    occurrence = await occurrence_service.handle_driver_report(
        db_session, get_settings(), tenant, _driver_message("5511900000222", "parada 42, cliente ausente")
    )

    assert occurrence.state == OccurrenceState.PENDING_HUMAN_QUEUE
    assert occurrence.customer_phone is None


async def test_invalid_stop_number_text_falls_back_to_human_queue(db_session, monkeypatch):
    """stop_number vindo da IA como texto não numérico não deve derrubar o
    fluxo — apenas ignora a busca na planilha."""
    tenant = await _make_tenant(db_session)
    fake_client = _FakeEvolutionClient()
    monkeypatch.setattr(occurrence_service, "evolution_client_for", lambda t, s: fake_client)
    monkeypatch.setattr(
        occurrence_service, "get_ai_provider",
        lambda settings: _FakeAIProvider(_classification_output("parada da esquina")),
    )

    occurrence = await occurrence_service.handle_driver_report(
        db_session, get_settings(), tenant, _driver_message("5511900000333", "parada da esquina, cliente ausente")
    )

    assert occurrence.state == OccurrenceState.PENDING_HUMAN_QUEUE
