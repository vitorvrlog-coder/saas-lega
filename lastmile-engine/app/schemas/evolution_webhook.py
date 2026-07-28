"""
Payload do webhook recebido do gateway evolution-go (fork em Go da Evolution
API, baseado na lib whatsmeow).

Formato de `data.Info` e `data.Message.conversation` (texto simples) foi
CONFIRMADO lendo o código real do projeto irmão whatsapp-saas
(backend/app/api/whatsapp.py). Os demais campos (áudio, botão, id da
mensagem) foram CONFIRMADOS lendo o código-fonte Go deste fork específico
(evolution-go 0.7.1), disponível em C:\\whatsapp-saas\\evolution-go:
- `pkg/whatsmeow/service/whatsmeow.go`: `postMap["data"] = rawEvt` grava o
  evento whatsmeow inteiro (*events.Message) como `data` — não há
  transformação manual, os nomes de campo JSON vêm direto das structs Go.
- `Info` = whatsmeow `types.MessageInfo` (embeds `MessageSource`), sem tags
  `json:` — logo os nomes JSON são os nomes dos campos Go exportados
  (`Sender`, `IsFromMe`, `ID`, `Chat`, `PushName`, ...).
- `Message` = protobuf `waE2E.Message`, COM tags `json:` explícitas em
  lowerCamelCase (`conversation`, `extendedTextMessage`, `audioMessage`).
- Exceção: `AudioMessage.URL` e `AudioMessage.PTT` têm tag json maiúscula
  (`"URL"`, `"PTT"`) — não seguem o padrão lowerCamelCase dos outros campos
  (ver whatsmeow-lib/proto/waE2E/WAWebProtobufsE2E.pb.go:15355,15360).
- `ButtonsResponseMessage.SelectedButtonID` tem tag `json:"selectedButtonID"`
  (ID maiúsculo, não "Id").
- `selectedDisplayText` fica dentro de um campo Go `oneof` (interface, sem
  tag json própria) — a serialização exata desse campo específico via
  `encoding/json` do Go NÃO foi confirmada (só o `selectedButtonID` é
  garantido). Por isso o parser usa `selectedDisplayText or
  selectedButtonID` como fallback — nunca fica sem conteúdo se o texto de
  exibição não vier no formato esperado.
- Evolution-go também dispara um evento SEPARADO `"ButtonClick"` pra
  cliques em botão (além do `"Message"` normal), com estrutura totalmente
  diferente (`data.buttonId`, `data.phone`, etc.) — e aparenta ter um bug
  no próprio fork (lê `dataMap["Sender"]`/`dataMap["FromMe"]` de um mapa
  que só tem as chaves `Info`/`Message` no nível raiz, então phone/jid
  provavelmente vêm nulos nesse evento). Por isso este parser ignora
  `"ButtonClick"` de propósito e trata botão só via `"Message"` — mais
  confiável.
"""
from pydantic import BaseModel, ConfigDict


class EvolutionInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    Sender: str
    IsFromMe: bool = False
    ID: str | None = None


class EvolutionAudioMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    URL: str | None = None
    mimetype: str | None = None
    seconds: int | None = None
    PTT: bool | None = None


class EvolutionButtonsResponseMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    selectedButtonID: str | None = None
    # Não confirmado contra payload real — ver docstring do módulo.
    selectedDisplayText: str | None = None


class EvolutionExtendedTextMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str | None = None


class EvolutionMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    conversation: str | None = None
    extendedTextMessage: EvolutionExtendedTextMessage | None = None
    # Assumidos (não confirmados contra payload real) — ver docstring do módulo.
    audioMessage: EvolutionAudioMessage | None = None
    buttonsResponseMessage: EvolutionButtonsResponseMessage | None = None


class EvolutionWebhookData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    Info: EvolutionInfo
    Message: EvolutionMessage


class EvolutionWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event: str
    instanceName: str
    data: EvolutionWebhookData | None = None


class EvolutionReceiptData(BaseModel):
    """Payload de um evento "Receipt" (ACK de entrega/leitura) — formato
    BEM diferente de "Message": types.events.Receipt embute
    types.MessageSource (sem tag json, campos "achatados" direto no nível
    de `data`) + MessageIDs/Type/Timestamp, confirmado lendo
    whatsmeow-lib/types/events/events.go e whatsmeow-lib/types/message.go
    do evolution-go. "Type" vazio ("") = entregue (ReceiptTypeDelivered),
    "read" = lido, "sender" = ACK de sincronia entre nossos próprios
    dispositivos vinculados (não é confirmação do destinatário — ignorado
    no parser)."""

    model_config = ConfigDict(extra="ignore")

    MessageIDs: list[str] = []
    Type: str = ""
    IsFromMe: bool = False


class EvolutionReceiptPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event: str
    instanceName: str
    data: EvolutionReceiptData | None = None
