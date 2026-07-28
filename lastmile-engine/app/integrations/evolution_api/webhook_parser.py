"""
Normaliza o payload bruto do webhook evolution-go (app.schemas.evolution_webhook)
num objeto simples que o resto do app consome, sem precisar conhecer o
formato do gateway.
"""
from dataclasses import dataclass

from app.db.models.enums import MessageContentType
from app.schemas.evolution_webhook import EvolutionReceiptPayload, EvolutionWebhookPayload

SENDER_SUFFIX = "@s.whatsapp.net"

# Mapeia types.ReceiptType (evolution-go/whatsmeow) pro vocabulário de
# MessageLog.delivery_status — "sender" e "retry" não são confirmação do
# destinatário (ver docstring de EvolutionReceiptData), por isso não têm
# entrada aqui e são ignorados por parse_receipt_webhook.
_RECEIPT_STATUS_MAP = {
    "": "delivered",
    "read": "read",
    "read-self": "read",
    "played": "played",
    "played-self": "played",
}


@dataclass
class ParsedReceipt:
    instance_name: str
    message_ids: list[str]
    status: str


def parse_receipt_webhook(payload: EvolutionReceiptPayload) -> ParsedReceipt | None:
    """Retorna None pra eventos irrelevantes pro rastreio de entrega.

    IMPORTANTE (confirmado em teste real contra o gateway): "IsFromMe" no
    Receipt descreve quem GEROU o recibo, não quem mandou a mensagem
    original — pra uma confirmação genuína do destinatário (motorista/
    cliente), IsFromMe vem False, porque quem "enviou" o evento de
    recibo é o destinatário, não nós. Um Type "sender" (recibo de
    sincronia entre nossos PRÓPRIOS dispositivos vinculados) é quem
    normalmente traz IsFromMe=True — e já é descartado abaixo por não
    ter entrada em _RECEIPT_STATUS_MAP, então checar IsFromMe aqui só
    causava falso-negativo em recibos genuínos (bug já corrigido)."""
    if payload.data is None or not payload.data.MessageIDs:
        return None
    status = _RECEIPT_STATUS_MAP.get(payload.data.Type)
    if status is None:
        return None
    return ParsedReceipt(
        instance_name=payload.instanceName, message_ids=payload.data.MessageIDs, status=status
    )


@dataclass
class ParsedInboundMessage:
    instance_name: str
    phone: str
    content_type: MessageContentType
    content_text: str | None
    audio_url: str | None
    external_message_id: str | None
    raw_payload: dict


def parse_inbound_webhook(
    payload: EvolutionWebhookPayload, raw_payload: dict
) -> ParsedInboundMessage | None:
    """Retorna None quando o evento deve ser ignorado (não é Message, é eco
    da própria instância, ou não tem conteúdo reconhecível)."""

    if payload.event != "Message" or payload.data is None:
        return None

    info = payload.data.Info
    message = payload.data.Message

    if info.IsFromMe:
        return None

    # Sender às vezes vem como LID (identificador interno do WhatsApp,
    # ex: "239414395584641@lid") em vez do JID com o telefone real —
    # confirmado em teste real, evolution-go às vezes não faz o swap
    # LID->telefone antes de disparar o webhook (log: "Detected LID/
    # WhatsApp JID swap case", nem sempre acontece a tempo). Sem o
    # telefone real não dá pra correlacionar a conversa nem fechar a
    # ocorrência depois — melhor ignorar o evento do que gravar um LID
    # como se fosse driver_phone/customer_phone.
    if not info.Sender.endswith(SENDER_SUFFIX):
        return None

    phone = info.Sender.replace(SENDER_SUFFIX, "")

    content_type = MessageContentType.UNKNOWN
    content_text: str | None = None
    audio_url: str | None = None

    if message.conversation:
        content_type = MessageContentType.TEXT
        content_text = message.conversation
    elif message.extendedTextMessage and message.extendedTextMessage.text:
        content_type = MessageContentType.TEXT
        content_text = message.extendedTextMessage.text
    elif message.buttonsResponseMessage:
        content_type = MessageContentType.BUTTON
        content_text = (
            message.buttonsResponseMessage.selectedDisplayText
            or message.buttonsResponseMessage.selectedButtonID
        )
    elif message.audioMessage:
        content_type = MessageContentType.AUDIO
        audio_url = message.audioMessage.URL

    return ParsedInboundMessage(
        instance_name=payload.instanceName,
        phone=phone,
        content_type=content_type,
        content_text=content_text,
        audio_url=audio_url,
        external_message_id=info.ID,
        raw_payload=raw_payload,
    )
