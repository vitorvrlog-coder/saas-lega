"""
Cliente HTTP para a WhatsApp Cloud API oficial (Meta Graph API). Substitui
app/integrations/evolution_api/client.py — motivo da troca: o gateway
não-oficial (evolution-go/whatsmeow) sofre rejeições intermitentes e
imprevisíveis do lado do WhatsApp (erro 463 / prekeys 503, confirmado em
produção não ser bug de código nem de infraestrutura própria), risco
estrutural de qualquer client que emula um app pessoal em vez de usar a
API business oficial.
"""
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

SEND_MAX_ATTEMPTS = 2
SEND_RETRY_DELAY_SECONDS = 3.0
SEND_TIMEOUT_SECONDS = 15.0

# Códigos de erro da Graph API que são rate-limit/transitórios — únicos que
# vale re-tentar. Qualquer outro código (template não aprovado, número
# inválido, token expirado etc.) é permanente: re-tentar não muda o
# resultado, só atrasa o retorno pro operador.
RETRYABLE_ERROR_CODES = {4, 80007, 130429, 131048}


class WhatsAppAPIError(Exception):
    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.body = body
        super().__init__(f"WhatsApp Cloud API retornou {status_code}: {body}")

    @property
    def error_code(self) -> int | None:
        import json

        try:
            parsed = json.loads(self.body)
        except (ValueError, TypeError):
            return None
        code = parsed.get("error", {}).get("code") if isinstance(parsed, dict) else None
        return code if isinstance(code, int) else None

    @property
    def is_retryable(self) -> bool:
        return self.error_code in RETRYABLE_ERROR_CODES


def extract_message_id(send_result: dict | str) -> str | None:
    """Extrai messages[0].id da resposta de /messages — o wamid que a Meta
    atribui à mensagem, usado pra correlacionar um evento de status
    (sent/delivered/read/failed) que chegar depois via webhook."""
    if not isinstance(send_result, dict):
        return None
    messages = send_result.get("messages")
    if not isinstance(messages, list) or not messages:
        return None
    message_id = messages[0].get("id")
    return message_id if isinstance(message_id, str) and message_id else None


def extract_resolved_phone(send_result: dict | str) -> str | None:
    """Extrai contacts[0].wa_id da resposta — o número que a Meta de fato
    resolveu para o destinatário (pode divergir do número digitado, ex:
    DDDs sem o nono dígito)."""
    if not isinstance(send_result, dict):
        return None
    contacts = send_result.get("contacts")
    if not isinstance(contacts, list) or not contacts:
        return None
    wa_id = contacts[0].get("wa_id")
    return wa_id if isinstance(wa_id, str) and wa_id else None


async def _request(method: str, url: str, timeout_seconds: float, **kwargs) -> dict | str:
    """Envolve qualquer falha de rede (timeout, conexão recusada, DNS) como
    WhatsAppAPIError — mesmo motivo do client anterior: sem isso, erros de
    transporte escapam do retry e do tratamento amigável nas rotas web."""
    body_summary = kwargs.get("json")
    logger.info("WhatsApp Cloud API → %s %s payload=%r", method, url, body_summary)
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        logger.warning("WhatsApp Cloud API ✗ %s %s falha de transporte: %s", method, url, exc)
        raise WhatsAppAPIError(0, f"falha de rede/timeout: {exc}") from exc

    if response.status_code >= 400:
        logger.warning(
            "WhatsApp Cloud API ✗ %s %s status=%d body=%s", method, url, response.status_code, response.text
        )
        raise WhatsAppAPIError(response.status_code, response.text)

    try:
        parsed = response.json()
    except ValueError:
        parsed = response.text

    logger.info("WhatsApp Cloud API ← %s %s status=%d body=%r", method, url, response.status_code, parsed)
    return parsed


class WhatsAppCloudClient:
    def __init__(
        self,
        phone_number_id: str,
        access_token: str,
        api_version: str = "v21.0",
        timeout_seconds: float = 60.0,
    ):
        self.phone_number_id = phone_number_id
        self.access_token = access_token
        self.api_version = api_version
        self.timeout_seconds = timeout_seconds

    def _base_url(self) -> str:
        return f"https://graph.facebook.com/{self.api_version}/{self.phone_number_id}"

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.access_token}", "Content-Type": "application/json"}

    async def _post(self, payload: dict, timeout_seconds: float | None = None) -> dict | str:
        url = f"{self._base_url()}/messages"
        return await _request(
            "POST", url, timeout_seconds or self.timeout_seconds, headers=self._headers(), json=payload
        )

    async def get_status(self) -> dict | str:
        """GET /{phone_number_id} — retorna verified_name/quality_rating/
        platform_type. Substitui o antigo get_status() (Connected/LoggedIn):
        na Cloud API não existe conceito de sessão conectada/desconectada,
        o número está sempre "ligado" enquanto o token for válido."""
        url = self._base_url()
        return await _request("GET", url, self.timeout_seconds, headers=self._headers())

    async def _post_with_retry(self, payload: dict, timeout_seconds: float | None = None) -> dict | str:
        last_error: WhatsAppAPIError | None = None
        for attempt in range(SEND_MAX_ATTEMPTS):
            try:
                return await self._post(payload, timeout_seconds=timeout_seconds)
            except WhatsAppAPIError as exc:
                last_error = exc
                if not exc.is_retryable:
                    raise
                if attempt < SEND_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(SEND_RETRY_DELAY_SECONDS)
        raise last_error

    async def send_text(self, phone: str, text: str) -> dict | str:
        """Mensagem de texto livre — só é aceita pela Meta dentro da janela
        de 24h de uma conversa aberta pelo destinatário (resposta). Fora
        dessa janela a Meta rejeita e é obrigatório usar send_template."""
        payload = {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "text",
            "text": {"body": text},
        }
        return await self._post_with_retry(payload, timeout_seconds=SEND_TIMEOUT_SECONDS)

    async def send_text_resolved(self, phone: str, text: str) -> tuple[dict | str, str | None]:
        result = await self.send_text(phone, text)
        resolved_phone = extract_resolved_phone(result)
        return result, resolved_phone

    async def send_template(
        self,
        phone: str,
        template_name: str,
        language: str,
        components: list[dict] | None = None,
    ) -> dict | str:
        """Mensagem via template pré-aprovado pela Meta — obrigatório para
        qualquer mensagem que INICIA contato (fora de uma janela de 24h já
        aberta). `components` segue o formato da Graph API, ex:
        [{"type": "body", "parameters": [{"type": "text", "text": "valor"}]}]
        pra preencher as variáveis {{1}}, {{2}}... do corpo do template."""
        payload = {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language},
                **({"components": components} if components else {}),
            },
        }
        return await self._post_with_retry(payload, timeout_seconds=SEND_TIMEOUT_SECONDS)

    async def send_interactive_buttons(
        self, phone: str, body_text: str, buttons: list[tuple[str, str]]
    ) -> dict | str:
        """Mensagem com até 3 botões de resposta rápida (limite da Graph
        API) — igual send_text, só funciona dentro da janela de 24h
        (resposta a uma mensagem recebida), não exige template aprovado.
        `buttons` é [(id, título)]; o clique volta no webhook como
        type=interactive/button_reply (ver webhook_parser.parse_inbound_webhook,
        já mapeado pra MessageContentType.BUTTON)."""
        payload = {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": body_text},
                "action": {
                    "buttons": [
                        {"type": "reply", "reply": {"id": btn_id, "title": title}}
                        for btn_id, title in buttons
                    ]
                },
            },
        }
        return await self._post_with_retry(payload, timeout_seconds=SEND_TIMEOUT_SECONDS)
