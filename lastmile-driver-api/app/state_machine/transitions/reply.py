"""
Regra de decisão da etapa 5: para onde a Occurrence vai depois que a IA
classifica a resposta do cliente final. Quando o cliente pede novo
endereço, a decisão final depende do cálculo de raio (etapa seguinte,
ver app.state_machine.transitions.radius) — aqui só sinalizamos que o
raio precisa ser checado, sem decidir o estado final ainda.
"""
import re
from dataclasses import dataclass

from app.db.models.enums import OccurrenceState
from app.schemas.ai_outputs import ReplyCategory, ReplyClassificationOutput

CONFIDENCE_ESCALATION_THRESHOLD = 0.6
# definitive_refusal fecha a entrega como insucesso IRREVERSÍVEL — barra
# mais alta que as outras categorias de propósito.
DEFINITIVE_REFUSAL_CONFIDENCE_THRESHOLD = 0.9

# Rede de segurança por palavra-chave, só pra definitive_refusal: mesmo
# depois de reforçar o prompt com exemplos explícitos, o modelo local
# (qwen2.5:3b, via Ollama) continuou classificando "Sim, pode pedir para
# retornar daqui a 5 minutos" (confirmação clara de reagendamento) como
# definitive_refusal, com confidence=1.0 e um "reasoning" que nem
# justificava logicamente a própria categoria escolhida — confirmado em
# teste real repetindo a mensagem contra o modelo já com o prompt
# atualizado. Nem ajuste de prompt nem threshold de confiança resolvem um
# modelo "confiantemente errado". Se a mensagem do cliente contém sinal
# claro de pedido de retorno/nova tentativa, um definitive_refusal da IA é
# tratado como suspeito e escalado pra revisão humana em vez de fechar a
# entrega como insucesso permanente sem chance de correção.
_RESCHEDULE_SIGNAL_RE = re.compile(
    r"\b(volt(a|e|ar)|retorn(a|e|ar)|passa(r)?\s+de\s+novo|tenta(r)?\s+de\s+novo|"
    r"outra\s+vez|de\s+novo|mais\s+tarde)\b",
    re.IGNORECASE,
)


def _looks_like_reschedule_request(customer_message: str | None) -> bool:
    return bool(customer_message) and bool(_RESCHEDULE_SIGNAL_RE.search(customer_message))


@dataclass
class ReplyDecision:
    category: ReplyCategory | None
    requires_radius_check: bool
    next_state: OccurrenceState | None  # None quando requires_radius_check=True
    escalated: bool
    new_address_text: str | None = None


def decide_after_reply_classification(
    is_valid_schema: bool,
    output: ReplyClassificationOutput | None,
    customer_message: str | None = None,
    full_autonomous_mode: bool = False,
    retry_state: OccurrenceState | None = None,
) -> ReplyDecision:
    """`retry_state` é o estado de espera (AWAITING_CUSTOMER_REPLY_1/_2) de
    onde a resposta atual veio — só usado quando full_autonomous_mode e a
    decisão normal seria escalar: em vez disso, volta pra lá pra repetir o
    ciclo pedindo esclarecimento ao cliente. Obrigatório nesse modo (quem
    chama sempre sabe de qual estado a ocorrência estava antes de
    PROCESSING_REPLY)."""
    escalate_target = retry_state if (full_autonomous_mode and retry_state) else OccurrenceState.ESCALATED_TO_HUMAN
    escalate_flag = not (full_autonomous_mode and retry_state)

    if not is_valid_schema or output is None:
        return ReplyDecision(
            category=None, requires_radius_check=False,
            next_state=escalate_target, escalated=escalate_flag,
        )

    if (
        output.is_ambiguous
        or output.category == ReplyCategory.AMBIGUOUS
        or output.confidence < CONFIDENCE_ESCALATION_THRESHOLD
    ):
        return ReplyDecision(
            category=output.category, requires_radius_check=False,
            next_state=escalate_target, escalated=escalate_flag,
        )

    if output.category == ReplyCategory.CONFIRMS_RESCHEDULE:
        return ReplyDecision(
            category=output.category, requires_radius_check=False,
            next_state=OccurrenceState.CLOSED_RESOLVED, escalated=False,
        )

    if output.category == ReplyCategory.DEFINITIVE_REFUSAL:
        if (
            output.confidence < DEFINITIVE_REFUSAL_CONFIDENCE_THRESHOLD
            or _looks_like_reschedule_request(customer_message)
        ):
            return ReplyDecision(
                category=output.category, requires_radius_check=False,
                next_state=escalate_target, escalated=escalate_flag,
            )
        return ReplyDecision(
            category=output.category, requires_radius_check=False,
            next_state=OccurrenceState.CLOSED_DEFINITIVE_FAILURE, escalated=False,
        )

    # REQUESTS_NEW_ADDRESS
    if not output.new_address_text:
        # Prompt já instrui a IA a marcar ambíguo nesse caso, mas o motor
        # nunca confia cegamente na IA — reforça a regra aqui também.
        return ReplyDecision(
            category=output.category, requires_radius_check=False,
            next_state=escalate_target, escalated=escalate_flag,
        )

    return ReplyDecision(
        category=output.category, requires_radius_check=True,
        next_state=None, escalated=False, new_address_text=output.new_address_text,
    )
