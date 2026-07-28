"""Seleciona o provider de IA por env var (AI_PROVIDER) — único ponto do
código que sabe quais providers existem."""
from app.ai.base import AIProvider
from app.ai.providers.anthropic import AnthropicProvider
from app.ai.providers.ollama import OllamaProvider
from app.core.config import Settings


class UnknownAIProviderError(Exception):
    pass


def get_ai_provider(settings: Settings) -> AIProvider:
    if settings.AI_PROVIDER == "ollama":
        return OllamaProvider(settings.OLLAMA_BASE_URL, settings.OLLAMA_MODEL)

    if settings.AI_PROVIDER == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise UnknownAIProviderError("ANTHROPIC_API_KEY não configurada")
        return AnthropicProvider(settings.ANTHROPIC_API_KEY, settings.ANTHROPIC_MODEL)

    raise UnknownAIProviderError(f"AI_PROVIDER desconhecido: {settings.AI_PROVIDER!r}")
