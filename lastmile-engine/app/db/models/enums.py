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
