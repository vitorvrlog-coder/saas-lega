"""
Cliente HTTP para o gateway evolution-go. Formato de envio (endpoints,
headers, corpo de texto/botão) CONFIRMADO lendo o código real do projeto
irmão whatsapp-saas (backend/app/services/whatsapp_service.py) — inclusive
a normalização de botões (_normalize_buttons), replicada aqui igual para
manter compatibilidade com o mesmo gateway.
"""
import asyncio
import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

# Confirmado em teste real: logo após reconectar um número, o WhatsApp às
# vezes rejeita a primeira mensagem (erro 463 do lado deles, transitório) e
# a MESMA mensagem funciona no reenvio poucos segundos depois — 1 retry com
# uma pequena espera evita que isso vire erro 500 pro operador.
SEND_MAX_ATTEMPTS = 2
SEND_RETRY_DELAY_SECONDS = 3.0
# O timeout do EvolutionClient (60s) é bom pra operações administrativas,
# mas envio de mensagem pra um contato novo pode ficar preso ~75-80s dentro
# do próprio gateway esperando o WhatsApp confirmar o número (usync) —
# confirmado em teste real. Falhar rápido do nosso lado (e deixar o retry
# tentar de novo) é melhor pro operador do que ficar mais de 2 minutos
# esperando uma resposta que não vem.
SEND_TIMEOUT_SECONDS = 15.0


class EvolutionAPIError(Exception):
    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.body = body
        super().__init__(f"Evolution retornou {status_code}: {body}")


@dataclass
class EvolutionButton:
    text: str
    type: str = "reply"  # "reply" | "url" | "call" | "copy"
    id: str | None = None
    url: str | None = None
    phone: str | None = None
    code: str | None = None


SENDER_SUFFIX = "@s.whatsapp.net"


def _as_jid(phone: str) -> str:
    """Manda o número já como JID completo (dígitos + @s.whatsapp.net) —
    CreateJID() do lado do evolution-go (pkg/utils/utils.go) só formata um
    número puro adicionando um "+" bugado antes do DDI (produz
    "+5511...@s.whatsapp.net", que não corresponde a nenhuma conta real —
    confirmado lendo o código-fonte do gateway em C:\\whatsapp-saas\\
    evolution-go). Quando o número já chega com "@s.whatsapp.net", essa
    função tem um retorno antecipado sem tocar no valor — por isso mandar
    o JID pronto evita o "+" indevido e garante entrega."""
    if phone.endswith(SENDER_SUFFIX):
        return phone
    return f"{phone}{SENDER_SUFFIX}"


def extract_message_id(send_result: dict | str) -> str | None:
    """Extrai data.Info.ID da resposta de /send/text|/send/button — o ID
    real que o WhatsApp atribuiu à mensagem (confirmado: gerado pelo
    gateway via GenerateMessageID() quando não mandamos "id" no payload,
    ver send_text). Guardar isso em MessageLog.external_message_id é o que
    permite correlacionar um evento de Receipt (ACK/entrega/leitura) que
    chegar depois via webhook com a mensagem específica que ele confirma."""
    if not isinstance(send_result, dict):
        return None
    message_id = send_result.get("data", {}).get("Info", {}).get("ID")
    return message_id if isinstance(message_id, str) and message_id else None


def extract_resolved_phone(send_result: dict | str) -> str | None:
    """Extrai data.Info.Chat da resposta de /send/text — o JID que o
    WhatsApp de fato resolveu para o número enviado, confirmado empiricamente
    contra a instância real (evolution-go 0.7.1)."""
    if not isinstance(send_result, dict):
        return None
    chat = send_result.get("data", {}).get("Info", {}).get("Chat")
    if not isinstance(chat, str) or not chat.endswith(SENDER_SUFFIX):
        return None
    return chat.replace(SENDER_SUFFIX, "")


def _normalize_buttons(buttons: list[EvolutionButton]) -> list[dict]:
    normalized = []
    for i, button in enumerate(buttons):
        item: dict = {"type": button.type}

        if button.type == "reply":
            item["displayText"] = button.text
            item["id"] = button.id or f"btn_{i + 1}"
        elif button.type == "url":
            item["displayText"] = button.text
            item["id"] = button.url
        elif button.type == "call":
            item["displayText"] = button.text
            item["id"] = button.phone
        elif button.type == "copy":
            item["displayText"] = button.text
            item["copyCode"] = button.code

        normalized.append(item)
    return normalized


async def _request(method: str, url: str, timeout_seconds: float, **kwargs) -> dict | str:
    """Envolve QUALQUER falha de rede (timeout, conexão recusada, DNS, etc.)
    como EvolutionAPIError — sem isso, erros de transporte (httpx.ReadTimeout
    e afins, distintos de uma resposta HTTP de erro) escapavam do retry do
    EvolutionClient e do tratamento amigável nas rotas web, batendo direto
    como exceção não tratada (confirmado em produção: timeout do gateway
    durante o worker de timeout virou traceback cru em vez de um erro
    tratável)."""
    body_summary = kwargs.get("json")
    logger.info("Evolution API → %s %s payload=%r", method, url, body_summary)
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        logger.warning("Evolution API ✗ %s %s falha de transporte: %s", method, url, exc)
        raise EvolutionAPIError(0, f"falha de rede/timeout: {exc}") from exc

    if response.status_code >= 400:
        logger.warning(
            "Evolution API ✗ %s %s status=%d body=%s", method, url, response.status_code, response.text
        )
        raise EvolutionAPIError(response.status_code, response.text)

    try:
        parsed = response.json()
    except ValueError:
        parsed = response.text

    logger.info("Evolution API ← %s %s status=%d body=%r", method, url, response.status_code, parsed)
    return parsed


async def create_evolution_instance(
    base_url: str,
    global_api_key: str,
    name: str,
    token: str,
    timeout_seconds: float = 30.0,
) -> dict | str:
    """POST /instance/create — único endpoint que usa a chave mestre
    (GLOBAL_API_KEY do evolution-go) em vez do token da instância, porque
    a instância ainda não existe. Usado só no provisionamento automático
    de um tenant novo (app.services.tenant_service)."""
    url = f"{base_url}/instance/create"
    headers = {"apikey": global_api_key, "Content-Type": "application/json"}
    payload = {"name": name, "token": token}
    return await _request("POST", url, timeout_seconds, headers=headers, json=payload)


async def _find_instance_id_by_name(
    base_url: str, global_api_key: str, name: str, timeout_seconds: float
) -> str | None:
    """GET /instance/all — o {instanceId} do DELETE é o UUID interno que o
    gateway gera na criação (instance.Id), não o "name" legível que a gente
    escolhe (ex: "vrlogistica") — confirmado testando contra o gateway real
    (erro "invalid UUID format" ao passar o name direto). Não tem endpoint
    de "delete por name", então resolve o UUID por aqui primeiro."""
    url = f"{base_url}/instance/all"
    headers = {"apikey": global_api_key}
    data = await _request("GET", url, timeout_seconds, headers=headers)

    instances = data.get("data", []) if isinstance(data, dict) else []
    for instance in instances:
        if instance.get("name") == name:
            return instance.get("id")
    return None


async def delete_evolution_instance(
    base_url: str,
    global_api_key: str,
    name: str,
    timeout_seconds: float = 30.0,
) -> dict | str:
    """DELETE /instance/delete/{instanceId} — chave mestre, igual create.
    Único jeito confirmado de destravar uma instância que "morreu sozinha"
    (celular desconectou/desvinculou): as rotas de status/disconnect/
    reconnect/logout da própria instância checam se o cliente ainda está
    conectado ANTES de agir e falham com "client disconnected" nesse
    estado — só o delete (que não faz essa checagem) limpa o cliente
    preso na memória do gateway, permitindo recriar do zero com
    create_evolution_instance() e pedir um QR novo de verdade."""
    instance_id = await _find_instance_id_by_name(base_url, global_api_key, name, timeout_seconds)
    if instance_id is None:
        raise EvolutionAPIError(404, f"Instância '{name}' não encontrada no gateway.")

    url = f"{base_url}/instance/delete/{instance_id}"
    headers = {"apikey": global_api_key}
    return await _request("DELETE", url, timeout_seconds, headers=headers)


@dataclass
class EvolutionClient:
    base_url: str
    instance: str
    token: str
    timeout_seconds: float = 60.0

    def _headers(self) -> dict:
        return {"apikey": self.token, "Content-Type": "application/json"}

    async def _post(self, endpoint: str, payload: dict, timeout_seconds: float | None = None) -> dict | str:
        url = f"{self.base_url}{endpoint}"
        return await _request(
            "POST", url, timeout_seconds or self.timeout_seconds, headers=self._headers(), json=payload
        )

    async def _get(self, endpoint: str) -> dict | str:
        url = f"{self.base_url}{endpoint}"
        return await _request("GET", url, self.timeout_seconds, headers=self._headers())

    async def connect(self, webhook_url: str, subscribe: list[str] | None = None) -> dict | str:
        """Liga a instância (identificada pelo token no header) ao webhook
        informado e inicia o processo de pareamento — depois disso já dá
        pra pedir o QR code via get_qr(). Inclui READ_RECEIPT por padrão:
        sem essa inscrição, o gateway confirma nosso /send/text com 200
        mas DESCARTA silenciosamente qualquer evento de confirmação de
        entrega/leitura (confirmado lendo pkg/whatsmeow/service/whatsmeow.go
        do evolution-go — eventos "Receipt" só são despachados pro webhook
        se READ_RECEIPT estiver na lista de subscriptions da instância) —
        sem isso, não existe como distinguir "gateway aceitou o POST" de
        "mensagem realmente chegou no WhatsApp do destinatário". Chamar
        connect() de novo numa instância já conectada atualiza a inscrição
        em tempo real, sem perder a sessão pareada (confirmado em teste
        real e lendo instance_service.go: Connect() -> UpdateInstanceSettings())."""
        payload = {"webhookUrl": webhook_url, "subscribe": subscribe or ["MESSAGE", "READ_RECEIPT"]}
        return await self._post("/instance/connect", payload)

    async def get_qr(self) -> dict | str:
        """Retorna {"data": {"Qrcode": "data:image/png;base64,...", "Code": "<pairing string>"}}
        — campos confirmados lendo instance_service.go do evolution-go (sem
        json tag, exportados com maiúscula = serializam com maiúscula).
        QR expira em ~40s — precisa ser pedido de novo se o operador
        demorar pra escanear (ver app.web.routes, polling via HTMX)."""
        return await self._get("/instance/qr")

    async def get_status(self) -> dict | str:
        """Retorna {"data": {"Connected": bool, "LoggedIn": bool, "Name": str}}."""
        return await self._get("/instance/status")

    async def _post_with_retry(
        self, endpoint: str, payload: dict, timeout_seconds: float | None = None
    ) -> dict | str:
        last_error: EvolutionAPIError | None = None
        for attempt in range(SEND_MAX_ATTEMPTS):
            try:
                return await self._post(endpoint, payload, timeout_seconds=timeout_seconds)
            except EvolutionAPIError as exc:
                last_error = exc
                if attempt < SEND_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(SEND_RETRY_DELAY_SECONDS)
        raise last_error

    async def send_text(self, phone: str, text: str) -> dict | str:
        # NUNCA passar "id" aqui — confirmado lendo pkg/sendMessage/service/
        # send_service.go do evolution-go (TextStruct.Id): esse campo não
        # identifica a instância (isso já vem do header apikey), é o ID da
        # MENSAGEM no protocolo WhatsApp em si. Uma versão anterior deste
        # cliente mandava "id": self.instance — ou seja, TODA mensagem
        # enviada usava o mesmo ID fixo ("vrlogistica" etc). WhatsApp
        # deduplica mensagens pelo ID por padrão; isso fazia o gateway
        # sempre confirmar "sucesso" (a chamada HTTP não falha) enquanto o
        # WhatsApp do destinatário descartava silenciosamente qualquer
        # mensagem além da primeira com aquele ID — causa raiz confirmada
        # de mensagens "enviadas" que nunca apareciam no WhatsApp real.
        # Omitir o campo deixa o gateway gerar um ID novo e único por
        # mensagem (GenerateMessageID()).
        payload = {"number": _as_jid(phone), "text": text}
        return await self._post_with_retry("/send/text", payload, timeout_seconds=SEND_TIMEOUT_SECONDS)

    async def send_text_resolved(self, phone: str, text: str) -> tuple[dict | str, str | None]:
        """Como send_text, mas também devolve o telefone que o WhatsApp
        efetivamente resolveu para o destinatário (data.Info.Chat na
        resposta) — números digitados manualmente (fila humana) podem
        divergir do formato canônico que o WhatsApp usa internamente
        (confirmado em teste real: DDDs onde o WhatsApp cadastra o celular
        sem o nono dígito). None se a resposta não trouxer esse campo."""
        result = await self.send_text(phone, text)
        resolved_phone = extract_resolved_phone(result)
        return result, resolved_phone

    async def send_buttons(
        self,
        phone: str,
        title: str,
        description: str,
        buttons: list[EvolutionButton],
        footer: str = "",
    ) -> dict | str:
        payload = {
            "number": _as_jid(phone),
            "title": title,
            "description": description,
            "footer": footer,
            "buttons": _normalize_buttons(buttons),
        }
        return await self._post_with_retry("/send/button", payload, timeout_seconds=SEND_TIMEOUT_SECONDS)
