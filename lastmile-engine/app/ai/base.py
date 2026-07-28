"""
Camada de abstração de IA. Nenhum código de negócio (state_machine,
services) chama um provider diretamente — sempre passa por
`run_structured`, que garante que a saída ou é um JSON validado contra o
schema esperado, ou é um resultado explicitamente marcado como inválido
(is_valid_schema=False), nunca um objeto parcial nem um default silencioso.
Quem decide o que fazer com is_valid_schema=False é o chamador (typicamente:
escalar para revisão humana).
"""
import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Generic, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class AIProviderError(Exception):
    """Falha de infraestrutura ao chamar o provedor (rede, API, timeout) —
    distinta de uma resposta que não bate com o schema esperado."""


class AIProvider(ABC):
    provider_name: str
    model_name: str

    @abstractmethod
    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        """Retorna a resposta bruta (texto) do modelo. Deve levantar
        AIProviderError em falha de rede/API."""
        raise NotImplementedError


@dataclass
class StructuredAIResult(Generic[T]):
    output: T | None
    raw_output: dict | None
    is_valid_schema: bool
    error_message: str | None
    provider: str
    model: str


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _extract_json_text(raw: str) -> str:
    """Alguns modelos envolvem o JSON em ```json ... ``` mesmo quando
    instruídos a não fazer isso — extrai o conteúdo do bloco se existir."""
    match = _JSON_FENCE_RE.search(raw)
    return match.group(1) if match else raw


async def run_structured(
    provider: AIProvider,
    system_prompt: str,
    user_prompt: str,
    schema: type[T],
    max_attempts: int = 2,
) -> StructuredAIResult[T]:
    """Tenta até max_attempts vezes antes de desistir — modelos locais
    pequenos às vezes erram um campo do schema numa tentativa (ex:
    esquecem "reasoning") mesmo respondendo certo logo em seguida; um
    retry evita escalar por uma falha passageira do modelo, sem nunca
    aceitar um resultado parcial (só volta is_valid_schema=True quando o
    schema realmente bate)."""
    result = await _run_structured_once(provider, system_prompt, user_prompt, schema)
    attempt = 1
    while not result.is_valid_schema and attempt < max_attempts:
        result = await _run_structured_once(provider, system_prompt, user_prompt, schema)
        attempt += 1
    return result


async def _run_structured_once(
    provider: AIProvider,
    system_prompt: str,
    user_prompt: str,
    schema: type[T],
) -> StructuredAIResult[T]:
    try:
        raw_text = await provider.complete(system_prompt, user_prompt)
    except AIProviderError as exc:
        return StructuredAIResult(
            output=None,
            raw_output=None,
            is_valid_schema=False,
            error_message=f"Falha ao chamar provedor de IA: {exc}",
            provider=provider.provider_name,
            model=provider.model_name,
        )

    json_text = _extract_json_text(raw_text)

    try:
        raw_output = json.loads(json_text)
    except json.JSONDecodeError as exc:
        return StructuredAIResult(
            output=None,
            raw_output=None,
            is_valid_schema=False,
            error_message=f"Resposta da IA não é JSON válido: {exc}",
            provider=provider.provider_name,
            model=provider.model_name,
        )

    try:
        parsed = schema.model_validate(raw_output)
    except ValidationError as exc:
        return StructuredAIResult(
            output=None,
            raw_output=raw_output,
            is_valid_schema=False,
            error_message=f"JSON não respeita o schema esperado: {exc}",
            provider=provider.provider_name,
            model=provider.model_name,
        )

    return StructuredAIResult(
        output=parsed,
        raw_output=raw_output,
        is_valid_schema=True,
        error_message=None,
        provider=provider.provider_name,
        model=provider.model_name,
    )
