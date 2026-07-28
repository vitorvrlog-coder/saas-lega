"""
Enums de domínio, compartilhados entre models e schemas Pydantic da IA.

Mantidos como str Enum para serem serializáveis diretamente em JSON (nos
logs de auditoria e nas respostas estruturadas da IA) sem conversão manual.
"""
import enum


class OccurrenceState(str, enum.Enum):
    REPORTED = "reported"                                  # motorista reportou, ainda não classificado
    CLASSIFYING = "classifying"                             # IA classificando o motivo
    PENDING_HUMAN_QUEUE = "pending_human_queue"             # aguardando operador preencher rota/contato (etapa plugável)
    CONTACTING_CUSTOMER_ATTEMPT_1 = "contacting_customer_attempt_1"
    AWAITING_CUSTOMER_REPLY_1 = "awaiting_customer_reply_1"
    CONTACTING_CUSTOMER_ATTEMPT_2 = "contacting_customer_attempt_2"
    AWAITING_CUSTOMER_REPLY_2 = "awaiting_customer_reply_2"
    PROCESSING_REPLY = "processing_reply"                   # IA classificando a resposta do cliente
    ESCALATED_TO_HUMAN = "escalated_to_human"               # ambiguidade / baixa confiança / erro de schema
    AWAITING_DRIVER_CLARIFICATION = "awaiting_driver_clarification"  # modo full: repergunta ao motorista em vez de escalar/fila humana
    CLOSED_RESOLVED = "closed_resolved"                     # reagendado/endereço aprovado
    CLOSED_DEFINITIVE_FAILURE = "closed_definitive_failure"  # recusado, fora de raio negado, sem resposta em 2 tentativas


class FailureReason(str, enum.Enum):
    ABSENT = "absent"                # ausente
    WRONG_ADDRESS = "wrong_address"  # endereço errado
    REFUSED = "refused"              # recusado -> pula contato com cliente
    DAMAGE = "damage"                # avaria
    RISK_AREA = "risk_area"          # área de risco


class TransitionActor(str, enum.Enum):
    DRIVER = "driver"
    CUSTOMER = "customer"
    AI = "ai"
    SYSTEM = "system"
    HUMAN_OPERATOR = "human_operator"


class MessageDirection(str, enum.Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class MessageParticipant(str, enum.Enum):
    DRIVER = "driver"
    CUSTOMER = "customer"


class MessageContentType(str, enum.Enum):
    TEXT = "text"
    AUDIO = "audio"
    BUTTON = "button"
    IMAGE = "image"
    UNKNOWN = "unknown"


class AIDecisionType(str, enum.Enum):
    FAILURE_CLASSIFICATION = "failure_classification"
    REPLY_CLASSIFICATION = "reply_classification"
    RADIUS_CHECK = "radius_check"


class InvoiceEntrySource(str, enum.Enum):
    XML = "xml"              # NFe estruturada — extração determinística, sem revisão humana
    PHOTO_OCR = "photo_ocr"  # DANFe fotografado — exige confirmação do motorista antes de contatar o cliente


class InvoiceEntryStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"  # OCR extraiu, aguardando motorista confirmar/corrigir (nunca usado para XML)
    CONFIRMED = "confirmed"            # dados aprovados (XML entra direto aqui), pronto pra promover a RouteManifestEntry
    REJECTED = "rejected"              # motorista descartou (ex: foto ilegível)
    CONTACT_SENT = "contact_sent"      # promovido a RouteManifestEntry e contato preventivo disparado


class DriverSubscriptionStatus(str, enum.Enum):
    PENDING = "pending"    # cobrança criada no Asaas, motorista ainda não pagou a 1ª fatura
    ACTIVE = "active"      # pagamento confirmado, em dia
    OVERDUE = "overdue"    # fatura de um ciclo venceu sem pagamento
    CANCELED = "canceled"  # assinatura cancelada (no Asaas ou por nós)


class DriverPlatform(str, enum.Enum):
    MELI = "meli"                    # Mercado Livre "Entregas"
    SHOPEE = "shopee"                # Shopee driver app
    DISTRIBUIDORA = "distribuidora"  # produto original de nota fiscal — nunca cria RouteCaptureSession


class RouteCaptureSessionStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"  # motorista ainda capturando telas
    REVIEW = "review"            # capturas terminadas, motorista revisando paradas extraídas
    CONFIRMED = "confirmed"      # motorista confirmou, pré-triagem disparada
    ROUTE_READY = "route_ready"  # otimizador rodou, rota sequenciada disponível
    CANCELED = "canceled"


class RouteCaptureStopOcrStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"


class RouteCapturePrescreenStatus(str, enum.Enum):
    NOT_SENT = "not_sent"
    SENT = "sent"
    CONFIRMED = "confirmed"
    UNAVAILABLE = "unavailable"
    ADDRESS_WRONG = "address_wrong"
    NO_RESPONSE_TIMEOUT = "no_response_timeout"
