"""
Schemas de saída estruturada da IA. Toda chamada a um provider de IA
(app.ai) DEVE retornar um JSON que valide contra um destes schemas —
schema inválido é erro tratado (ver app.ai.base), nunca texto livre
interpretado por regex e nunca um default assumido silenciosamente.

extra="ignore": tolera campos a mais que o modelo eventualmente devolva
(comentários, chain-of-thought etc.), mas continua exigindo os campos e
tipos obrigatórios abaixo — é aí que a validação de fato acontece.
"""
import enum

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import FailureReason


class AIOutputBase(BaseModel):
    model_config = ConfigDict(extra="ignore")

    confidence: float = Field(ge=0.0, le=1.0)
    is_ambiguous: bool = False
    reasoning: str


class FailureClassificationOutput(AIOutputBase):
    """Etapa 2 do fluxo: motorista reporta insucesso, IA classifica o motivo.

    customer_phone/original_address são opcionais: preenchidos só quando o
    motorista já manda esses dados junto do relato (fluxo automatizado, sem
    passar pela fila humana) — None quando não vieram na mensagem. Nunca
    inventados: se a IA não tem certeza do número, deixa null e o motor
    cai de volta na fila humana (mesmo comportamento de hoje).

    stop_number: número da parada/sequência da rota, só preenchido se o
    motorista citar (ex: "parada 12"). Usado por
    app.services.manifest_service.find_manifest_entry pra buscar
    telefone/endereço do cliente na planilha de rota importada, sem passar
    pela fila humana nem perguntar de novo pro motorista. Mesma disciplina:
    nunca inventado."""

    failure_reason: FailureReason
    requires_customer_contact: bool
    customer_phone: str | None = None
    original_address: str | None = None
    stop_number: str | None = None


class ReplyCategory(str, enum.Enum):
    CONFIRMS_RESCHEDULE = "confirms_reschedule"
    REQUESTS_NEW_ADDRESS = "requests_new_address"
    DEFINITIVE_REFUSAL = "definitive_refusal"
    AMBIGUOUS = "ambiguous"


class ReplyClassificationOutput(AIOutputBase):
    """Etapa 5 do fluxo: IA classifica a resposta do cliente final."""

    category: ReplyCategory
    # Só preenchido quando category == REQUESTS_NEW_ADDRESS.
    new_address_text: str | None = None


class RadiusCheckOutput(BaseModel):
    """
    Não é uma decisão de IA (é cálculo determinístico de geo), mas é
    registrada em ai_decision_logs (ai_provider="system") para manter a
    trilha de auditoria completa de toda decisão automática do motor.
    """

    model_config = ConfigDict(extra="ignore")

    within_radius: bool
    distance_km: float
    allowed_radius_km: float
