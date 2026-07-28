"""
Regra de decisão da etapa 2: para onde a Occurrence vai depois que a IA
classifica o motivo do insucesso. Função pura (sem I/O) — recebe o
resultado já validado (ou não) da IA e devolve a decisão; quem chama grava
no banco via app.state_machine.engine.transition.
"""
from dataclasses import dataclass

from app.db.models.enums import FailureReason, OccurrenceState
from app.integrations.whatsapp_cloud.phone import BR_FULL_LENGTHS, normalize_br_phone
from app.schemas.ai_outputs import FailureClassificationOutput

# Abaixo deste nível de confiança, mesmo uma classificação com schema válido
# escala para humano — "ambiguidade sempre escala para humano" é
# não-negociável (ver handoff), não fica a critério só do campo is_ambiguous.
CONFIDENCE_ESCALATION_THRESHOLD = 0.6


def _looks_like_valid_br_phone(phone: str | None) -> bool:
    """normalize_br_phone() nunca levanta erro pra número incompleto (ex: só
    8 dígitos, sem DDD) — devolve os dígitos como vieram, sem prefixo. Isso
    já causou uma tentativa real de contato pra "+91106951" (DDD "47" ficou
    de fora da extração da IA), rejeitada pelo WhatsApp como "not
    registered". Checar o tamanho aqui evita a tentativa perdida: se não
    tem cara de telefone brasileiro completo, trata como se não tivesse
    vindo (cai na fila humana igual a um customer_phone=None)."""
    if not phone:
        return False
    return len(normalize_br_phone(phone)) in BR_FULL_LENGTHS


@dataclass
class ClassificationDecision:
    next_state: OccurrenceState
    failure_reason: FailureReason | None
    requires_customer_contact: bool | None
    escalated: bool
    # Preenchidos só quando next_state=CONTACTING_CUSTOMER_ATTEMPT_1 (motorista
    # já mandou telefone + endereço junto do relato, pulando a fila humana).
    customer_phone: str | None = None
    original_address: str | None = None
    # Só preenchido quando next_state=AWAITING_DRIVER_CLARIFICATION (modo
    # full) — qual dos dois motivos levou à repergunta, pra escolher o
    # template certo ("ambiguous" = motivo incompreensível/schema inválido,
    # "missing_contact_info" = motivo ok mas falta telefone/endereço).
    clarification_reason: str | None = None


def decide_after_classification(
    is_valid_schema: bool,
    output: FailureClassificationOutput | None,
    full_autonomous_mode: bool = False,
) -> ClassificationDecision:
    if not is_valid_schema or output is None:
        if full_autonomous_mode:
            return ClassificationDecision(
                next_state=OccurrenceState.AWAITING_DRIVER_CLARIFICATION,
                failure_reason=None,
                requires_customer_contact=None,
                escalated=False,
                clarification_reason="ambiguous",
            )
        return ClassificationDecision(
            next_state=OccurrenceState.ESCALATED_TO_HUMAN,
            failure_reason=None,
            requires_customer_contact=None,
            escalated=True,
        )

    if output.is_ambiguous or output.confidence < CONFIDENCE_ESCALATION_THRESHOLD:
        if full_autonomous_mode:
            return ClassificationDecision(
                next_state=OccurrenceState.AWAITING_DRIVER_CLARIFICATION,
                failure_reason=output.failure_reason,
                requires_customer_contact=output.requires_customer_contact,
                escalated=False,
                clarification_reason="ambiguous",
            )
        return ClassificationDecision(
            next_state=OccurrenceState.ESCALATED_TO_HUMAN,
            failure_reason=output.failure_reason,
            requires_customer_contact=output.requires_customer_contact,
            escalated=True,
        )

    if output.failure_reason == FailureReason.REFUSED:
        # Recusado pula contato com cliente e vai direto pra fechamento.
        return ClassificationDecision(
            next_state=OccurrenceState.CLOSED_DEFINITIVE_FAILURE,
            failure_reason=output.failure_reason,
            requires_customer_contact=False,
            escalated=False,
        )

    if (
        output.requires_customer_contact
        and _looks_like_valid_br_phone(output.customer_phone)
        and output.original_address
    ):
        # Motorista já informou telefone do cliente e endereço original no
        # próprio relato — pula a fila humana e contata o cliente direto
        # (mesmo efeito que um operador preencheria manualmente).
        return ClassificationDecision(
            next_state=OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1,
            failure_reason=output.failure_reason,
            requires_customer_contact=output.requires_customer_contact,
            escalated=False,
            customer_phone=output.customer_phone,
            original_address=output.original_address,
        )

    if full_autonomous_mode:
        return ClassificationDecision(
            next_state=OccurrenceState.AWAITING_DRIVER_CLARIFICATION,
            failure_reason=output.failure_reason,
            requires_customer_contact=output.requires_customer_contact,
            escalated=False,
            clarification_reason="missing_contact_info",
        )

    return ClassificationDecision(
        next_state=OccurrenceState.PENDING_HUMAN_QUEUE,
        failure_reason=output.failure_reason,
        requires_customer_contact=output.requires_customer_contact,
        escalated=False,
    )
