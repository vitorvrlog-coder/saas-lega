"""Testes de app.ai.base.run_structured — provider falso (sem rede), foco
na orquestração de validação/retry, não na integração real com um modelo."""
from pydantic import BaseModel

from app.ai.base import AIProvider, AIProviderError, run_structured


class _Output(BaseModel):
    value: str


class _FakeProvider(AIProvider):
    def __init__(self, responses: list[str] | None = None, error: bool = False):
        self.provider_name = "fake"
        self.model_name = "fake-model"
        self._responses = responses or []
        self._error = error
        self.call_count = 0

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.call_count += 1
        if self._error:
            raise AIProviderError("falha simulada de rede")
        return self._responses[self.call_count - 1]


async def test_valid_schema_on_first_try_does_not_retry():
    provider = _FakeProvider(responses=['{"value": "ok"}'])
    result = await run_structured(provider, "sys", "user", _Output)

    assert result.is_valid_schema is True
    assert result.output.value == "ok"
    assert provider.call_count == 1


async def test_retries_once_after_invalid_schema_then_succeeds():
    provider = _FakeProvider(responses=['{"wrong_field": "x"}', '{"value": "ok"}'])
    result = await run_structured(provider, "sys", "user", _Output)

    assert result.is_valid_schema is True
    assert result.output.value == "ok"
    assert provider.call_count == 2


async def test_gives_up_after_max_attempts_exhausted():
    provider = _FakeProvider(responses=['{"wrong_field": "x"}', '{"wrong_field": "y"}'])
    result = await run_structured(provider, "sys", "user", _Output)

    assert result.is_valid_schema is False
    assert provider.call_count == 2


async def test_provider_error_is_also_retried():
    provider = _FakeProvider(error=True)
    result = await run_structured(provider, "sys", "user", _Output)

    assert result.is_valid_schema is False
    assert "falha simulada de rede" in result.error_message
    assert provider.call_count == 2


async def test_max_attempts_is_configurable():
    provider = _FakeProvider(responses=['{"wrong_field": "x"}'] * 5)
    result = await run_structured(provider, "sys", "user", _Output, max_attempts=3)

    assert result.is_valid_schema is False
    assert provider.call_count == 3
