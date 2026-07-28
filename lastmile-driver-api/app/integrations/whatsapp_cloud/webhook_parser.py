"""
Normaliza o payload bruto do webhook da WhatsApp Cloud API
(app.schemas.whatsapp_webhook) num objeto simples que o resto do app
consome, sem precisar conhecer o formato da Meta. Substitui
app.integrations.evolution_api.webhook_parser.

Diferente do gateway anterior, mensagem inbound e status de entrega
chegam no MESMO payload (value.messages vs value.statuses) — por isso
aqui existem duas funções de extração que operam sobre o mesmo
WhatsAppWebhookPayload, cada uma retornando uma lista (pode haver mais de
uma mensagem/status por payload).
"""
from dataclasses import dataclass

from app.db.models.enums import MessageContentType
from app.schemas.whatsapp_webhook import WhatsAppWebhookPayload

# Mapeia value.statuses[].status (Meta) pro vocabulário de
# MessageLog.delivery_status. "failed" não tem equivalente direto no rank
# atual (_DELIVERY_STATUS_RANK em occurrence_service) — mapeado como
# "failed" mesmo assim; quem aplica o update decide o que fazer com um
# status desconhecido pro rank (hoje: ignora silenciosamente).
_STATUS_MAP = {
    "sent": "sent",
    "delivered": "delivered",
    "read": "read",
    "failed": "failed",
}


@dataclass
class ParsedReceipt:
    phone_number_id: str
    message_ids: list[str]
    status: str


def parse_receipt_webhook(payload: WhatsAppWebhookPayload) -> list[ParsedReceipt]:
    """Retorna uma entrada por (phone_number_id, status) — normalmente só
    uma, mas o formato da Meta permite múltiplos entries/changes por
    payload (ex: batching)."""
    receipts: list[ParsedReceipt] = []
    for entry in payload.entry:
        for change in entry.changes:
            value = change.value
            if not value.statuses:
                continue
            by_status: dict[str, list[str]] = {}
            for status_event in value.statuses:
                mapped = _STATUS_MAP.get(status_event.status)
                if mapped is None:
                    continue
                by_status.setdefault(mapped, []).append(status_event.id)
            for status, message_ids in by_status.items():
                receipts.append(
                    ParsedReceipt(
                        phone_number_id=value.metadata.phone_number_id,
                        message_ids=message_ids,
                        status=status,
                    )
                )
    return receipts


@dataclass
class ParsedInboundMessage:
    phone_number_id: str
    phone: str
    content_type: MessageContentType
    content_text: str | None
    audio_url: str | None
    external_message_id: str | None
    raw_payload: dict


def parse_inbound_webhook(
    payload: WhatsAppWebhookPayload, raw_payload: dict
) -> list[ParsedInboundMessage]:
    """Retorna uma entrada por mensagem inbound presente no payload (pode
    ser mais de uma em tese, na prática a Meta manda uma por POST)."""
    parsed: list[ParsedInboundMessage] = []
    for entry in payload.entry:
        for change in entry.changes:
            value = change.value
            for message in value.messages:
                content_type = MessageContentType.UNKNOWN
                content_text: str | None = None
                audio_url: str | None = None

                if message.type == "text" and message.text:
                    content_type = MessageContentType.TEXT
                    content_text = message.text.body
                elif message.type == "interactive" and message.interactive:
                    content_type = MessageContentType.BUTTON
                    button_reply = message.interactive.button_reply
                    content_text = (
                        (button_reply.title or button_reply.id) if button_reply else None
                    )
                elif message.type == "audio" and message.audio:
                    content_type = MessageContentType.AUDIO
                    # A Cloud API não manda URL direta — retorna um media
                    # id que precisa ser resolvido via GET /{media_id}
                    # separado, autenticado com o access_token. Guardamos
                    # o id aqui; resolver a URL fica pra quem consome o
                    # áudio (fora do escopo do parser, que só normaliza).
                    audio_url = message.audio.id

                parsed.append(
                    ParsedInboundMessage(
                        phone_number_id=value.metadata.phone_number_id,
                        phone=message.from_,
                        content_type=content_type,
                        content_text=content_text,
                        audio_url=audio_url,
                        external_message_id=message.id,
                        raw_payload=raw_payload,
                    )
                )
    return parsed
