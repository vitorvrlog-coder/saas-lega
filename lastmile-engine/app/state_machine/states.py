"""
Matriz de transições legais entre estados de uma Occurrence. Nenhum código
deve atribuir `occurrence.state = X` diretamente — sempre via
app.state_machine.engine.transition(), que valida contra este mapa antes de
aplicar e sempre grava o log append-only em state_transitions.
"""
from app.db.models.enums import OccurrenceState as S

ALLOWED_TRANSITIONS: dict[S, set[S]] = {
    S.REPORTED: {S.CLASSIFYING},
    S.CLASSIFYING: {
        S.PENDING_HUMAN_QUEUE,
        S.CONTACTING_CUSTOMER_ATTEMPT_1,  # motorista já mandou telefone+endereço, pula fila humana
        S.CLOSED_DEFINITIVE_FAILURE,  # motivo = recusado, pula contato com cliente
        S.ESCALATED_TO_HUMAN,  # ambíguo / baixa confiança / schema inválido
    },
    S.PENDING_HUMAN_QUEUE: {S.CONTACTING_CUSTOMER_ATTEMPT_1},
    S.CONTACTING_CUSTOMER_ATTEMPT_1: {
        S.AWAITING_CUSTOMER_REPLY_1,
        # Fallback do fluxo automatizado (motorista já mandou telefone+
        # endereço): se o envio automático pro cliente falhar (gateway/
        # WhatsApp instável), cai pra fila humana revisar manualmente em
        # vez de perder o relato já classificado.
        S.PENDING_HUMAN_QUEUE,
    },
    S.AWAITING_CUSTOMER_REPLY_1: {
        S.PROCESSING_REPLY,
        S.CONTACTING_CUSTOMER_ATTEMPT_2,  # timeout tentativa 1
    },
    S.CONTACTING_CUSTOMER_ATTEMPT_2: {S.AWAITING_CUSTOMER_REPLY_2},
    S.AWAITING_CUSTOMER_REPLY_2: {
        S.PROCESSING_REPLY,
        S.CLOSED_DEFINITIVE_FAILURE,  # timeout tentativa 2, sem resposta
    },
    S.PROCESSING_REPLY: {
        S.CLOSED_RESOLVED,  # reagendado ou endereço aprovado dentro do raio
        S.CLOSED_DEFINITIVE_FAILURE,  # recusa definitiva ou endereço fora do raio
        S.ESCALATED_TO_HUMAN,  # resposta ambígua / schema inválido
    },
    # Única saída não-terminal: resolução manual pelo operador humano
    # (app.services.escalation_service), que decide no lugar da IA na
    # etapa em que a ocorrência escalou e retoma o mesmo fluxo dali —
    # PENDING_HUMAN_QUEUE se a escalação foi na classificação (etapa 2),
    # CLOSED_RESOLVED/CLOSED_DEFINITIVE_FAILURE se foi na resposta do
    # cliente (etapa 5) ou no cálculo de raio (etapa 5b).
    S.ESCALATED_TO_HUMAN: {
        S.PENDING_HUMAN_QUEUE,
        S.CLOSED_RESOLVED,
        S.CLOSED_DEFINITIVE_FAILURE,
    },
    # Estados terminais — nenhuma transição automática sai deles.
    S.CLOSED_RESOLVED: set(),
    S.CLOSED_DEFINITIVE_FAILURE: set(),
}


def is_valid_transition(from_state: S, to_state: S) -> bool:
    return to_state in ALLOWED_TRANSITIONS.get(from_state, set())
