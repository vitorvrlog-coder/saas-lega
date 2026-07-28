"""
Payload do webhook da WhatsApp Cloud API (Meta), substitui
app.schemas.evolution_webhook. Formato documentado pela Meta (Graph API
Webhooks para WhatsApp Business Account):
`entry[].changes[].value` contém `messages[]` (evento inbound) OU
`statuses[]` (evento de status de entrega) — os dois tipos de evento
chegam no MESMO payload de POST, diferente do gateway anterior que
disparava eventos HTTP separados ("Message" vs "Receipt").
"""
from pydantic import BaseModel, ConfigDict, Field


class WhatsAppTextContent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    body: str | None = None


class WhatsAppButtonReply(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    title: str | None = None


class WhatsAppInteractive(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str | None = None
    button_reply: WhatsAppButtonReply | None = None


class WhatsAppAudio(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    mime_type: str | None = None


class WhatsAppInboundMessage(BaseModel):
    # "from" é palavra reservada em Python — Field(alias=...) mapeia o
    # campo JSON "from" pro atributo "from_" sem precisar de populate_by_name.
    model_config = ConfigDict(extra="ignore")

    id: str
    from_: str = Field(alias="from")
    type: str
    text: WhatsAppTextContent | None = None
    interactive: WhatsAppInteractive | None = None
    audio: WhatsAppAudio | None = None


class WhatsAppStatusError(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: int | None = None
    title: str | None = None


class WhatsAppStatus(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    status: str
    recipient_id: str | None = None
    errors: list[WhatsAppStatusError] = []


class WhatsAppMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    phone_number_id: str


class WhatsAppChangeValue(BaseModel):
    model_config = ConfigDict(extra="ignore")

    metadata: WhatsAppMetadata
    messages: list[WhatsAppInboundMessage] = []
    statuses: list[WhatsAppStatus] = []


class WhatsAppChange(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: WhatsAppChangeValue
    field: str | None = None


class WhatsAppEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    changes: list[WhatsAppChange] = []


class WhatsAppWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object: str | None = None
    entry: list[WhatsAppEntry] = []
