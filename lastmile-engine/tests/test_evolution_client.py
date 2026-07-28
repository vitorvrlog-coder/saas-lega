import pytest

import app.integrations.evolution_api.client as evolution_client_module
from app.integrations.evolution_api.client import (
    EvolutionAPIError,
    EvolutionClient,
    extract_resolved_phone,
)


def _make_client() -> EvolutionClient:
    return EvolutionClient(base_url="http://fake", instance="fake-instance", token="fake-token")


async def test_send_text_succeeds_without_retry(monkeypatch):
    client = _make_client()
    call_count = 0

    async def fake_post(endpoint, payload, timeout_seconds=None):
        nonlocal call_count
        call_count += 1
        return {"data": {}}

    monkeypatch.setattr(client, "_post", fake_post)

    result = await client.send_text("5511900000000", "oi")

    assert result == {"data": {}}
    assert call_count == 1


async def test_send_text_retries_once_after_transient_failure(monkeypatch):
    monkeypatch.setattr(evolution_client_module, "SEND_RETRY_DELAY_SECONDS", 0)
    client = _make_client()
    call_count = 0

    async def fake_post(endpoint, payload, timeout_seconds=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise EvolutionAPIError(500, '{"error":"server returned error 463"}')
        return {"data": {"ok": True}}

    monkeypatch.setattr(client, "_post", fake_post)

    result = await client.send_text("5511900000000", "oi")

    assert result == {"data": {"ok": True}}
    assert call_count == 2


async def test_send_text_gives_up_after_max_attempts(monkeypatch):
    monkeypatch.setattr(evolution_client_module, "SEND_RETRY_DELAY_SECONDS", 0)
    client = _make_client()
    call_count = 0

    async def fake_post(endpoint, payload, timeout_seconds=None):
        nonlocal call_count
        call_count += 1
        raise EvolutionAPIError(500, '{"error":"server returned error 463"}')

    monkeypatch.setattr(client, "_post", fake_post)

    with pytest.raises(EvolutionAPIError):
        await client.send_text("5511900000000", "oi")

    assert call_count == 2


def test_extracts_resolved_phone_from_send_response():
    response = {"data": {"Info": {"Chat": "556981309227@s.whatsapp.net"}}}
    assert extract_resolved_phone(response) == "556981309227"


def test_returns_none_when_response_is_string():
    assert extract_resolved_phone("erro qualquer") is None


def test_returns_none_when_chat_missing():
    assert extract_resolved_phone({"data": {"Info": {}}}) is None


def test_returns_none_when_chat_not_whatsapp_format():
    response = {"data": {"Info": {"Chat": "120363423074701793@g.us"}}}
    assert extract_resolved_phone(response) is None
