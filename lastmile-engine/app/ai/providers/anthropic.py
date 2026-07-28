"""Provider Anthropic (Claude Haiku 4.5) — alternativa trocável via
AI_PROVIDER=anthropic, sem alterar código de negócio."""
import anthropic

from app.ai.base import AIProvider, AIProviderError


class AnthropicProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        self.provider_name = "anthropic"
        self.model_name = model
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        try:
            response = await self._client.messages.create(
                model=self.model_name,
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
        except anthropic.APIError as exc:
            raise AIProviderError(str(exc)) from exc

        return "".join(block.text for block in response.content if block.type == "text")
