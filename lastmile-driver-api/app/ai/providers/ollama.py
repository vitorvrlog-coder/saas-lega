"""Provider Ollama (modelo local) — opção padrão (AI_PROVIDER=ollama)."""
import httpx

from app.ai.base import AIProvider, AIProviderError


class OllamaProvider(AIProvider):
    def __init__(self, base_url: str, model: str):
        self.provider_name = "ollama"
        self.model_name = model
        self._base_url = base_url

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
            "format": "json",
        }

        try:
            # 120s: modelos "thinking" locais (ex: qwen3) podem ficar bem
            # acima de 60s em hardware modesto, sobretudo em cold start.
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(f"{self._base_url}/api/chat", json=payload)
        except httpx.HTTPError as exc:
            raise AIProviderError(str(exc) or repr(exc)) from exc

        if response.status_code >= 400:
            raise AIProviderError(f"Ollama retornou {response.status_code}: {response.text}")

        data = response.json()
        try:
            return data["message"]["content"]
        except (KeyError, TypeError) as exc:
            raise AIProviderError(f"Resposta do Ollama em formato inesperado: {data}") from exc
