from app.db.models.enums import FailureReason, OccurrenceState
from app.schemas.ai_outputs import FailureClassificationOutput, ReplyCategory, ReplyClassificationOutput
from app.state_machine.transitions.classification import decide_after_classification
from app.state_machine.transitions.radius import decide_after_radius_check
from app.state_machine.transitions.reply import decide_after_reply_classification
from app.state_machine.transitions.timeout import decide_after_timeout


def _failure_output(**overrides):
    defaults = dict(
        failure_reason=FailureReason.ABSENT, requires_customer_contact=True,
        confidence=0.9, is_ambiguous=False, reasoning="teste",
    )
    defaults.update(overrides)
    return FailureClassificationOutput(**defaults)


def test_classification_invalid_schema_escalates():
    decision = decide_after_classification(False, None)
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN
    assert decision.escalated is True


def test_classification_low_confidence_escalates():
    output = _failure_output(confidence=0.3)
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN


def test_classification_ambiguous_escalates_even_with_high_confidence():
    output = _failure_output(confidence=0.95, is_ambiguous=True)
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN


def test_classification_refused_skips_customer_contact():
    output = _failure_output(failure_reason=FailureReason.REFUSED)
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE
    assert decision.requires_customer_contact is False


def test_classification_normal_case_goes_to_human_queue():
    output = _failure_output(failure_reason=FailureReason.DAMAGE)
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.PENDING_HUMAN_QUEUE


def test_classification_with_customer_phone_and_address_skips_human_queue():
    output = _failure_output(
        failure_reason=FailureReason.ABSENT,
        customer_phone="47999998888", original_address="Rua Teste, 100",
    )
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_1
    assert decision.customer_phone == "47999998888"
    assert decision.original_address == "Rua Teste, 100"


def test_classification_with_only_phone_still_goes_to_human_queue():
    output = _failure_output(failure_reason=FailureReason.ABSENT, customer_phone="47999998888")
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.PENDING_HUMAN_QUEUE


def test_classification_with_only_address_still_goes_to_human_queue():
    output = _failure_output(failure_reason=FailureReason.ABSENT, original_address="Rua Teste, 100")
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.PENDING_HUMAN_QUEUE


def test_classification_with_incomplete_phone_still_goes_to_human_queue():
    """Regressão: IA extraiu só "91106951" (sem DDD, motorista escreveu o
    DDD separado do número) — WhatsApp rejeitou como número não registrado
    numa tentativa real. normalize_br_phone não valida tamanho, então essa
    checagem tem que acontecer aqui antes de pular a fila humana."""
    output = _failure_output(
        failure_reason=FailureReason.ABSENT,
        customer_phone="91106951", original_address="Rua Teste, 100",
    )
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.PENDING_HUMAN_QUEUE


def test_classification_refused_ignores_extracted_phone_and_address():
    output = _failure_output(
        failure_reason=FailureReason.REFUSED,
        customer_phone="47999998888", original_address="Rua Teste, 100",
    )
    decision = decide_after_classification(True, output)
    assert decision.next_state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE


def _reply_output(**overrides):
    defaults = dict(
        category=ReplyCategory.CONFIRMS_RESCHEDULE, new_address_text=None,
        confidence=0.9, is_ambiguous=False, reasoning="teste",
    )
    defaults.update(overrides)
    return ReplyClassificationOutput(**defaults)


def test_reply_invalid_schema_escalates():
    decision = decide_after_reply_classification(False, None)
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN


def test_reply_confirms_reschedule_closes_resolved():
    decision = decide_after_reply_classification(True, _reply_output())
    assert decision.next_state == OccurrenceState.CLOSED_RESOLVED
    assert decision.requires_radius_check is False


def test_reply_definitive_refusal_closes_failed():
    decision = decide_after_reply_classification(
        True, _reply_output(category=ReplyCategory.DEFINITIVE_REFUSAL)
    )
    assert decision.next_state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE


def test_reply_definitive_refusal_below_stricter_threshold_escalates():
    """Regressão: confiança abaixo do threshold GERAL (0.6) já escalava,
    mas definitive_refusal é irreversível e merece barra mais alta — 0.75
    passaria no threshold geral mas não deve fechar como insucesso
    definitivo sem revisão humana (ver DEFINITIVE_REFUSAL_CONFIDENCE_THRESHOLD)."""
    decision = decide_after_reply_classification(
        True, _reply_output(category=ReplyCategory.DEFINITIVE_REFUSAL, confidence=0.75)
    )
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN
    assert decision.escalated is True


def test_reply_definitive_refusal_with_reschedule_wording_escalates_despite_high_confidence():
    """Regressão real: "Sim, pode pedir para retornar daqui a 5 minutos"
    (pedido claro de nova tentativa) saiu classificado pelo modelo local
    como definitive_refusal com confidence=1.0 — nem prompt nem threshold
    de confiança pegam um modelo "confiantemente errado". A rede de
    segurança por palavra-chave (_looks_like_reschedule_request) precisa
    escalar esse caso mesmo com confidence máxima."""
    decision = decide_after_reply_classification(
        True,
        _reply_output(category=ReplyCategory.DEFINITIVE_REFUSAL, confidence=1.0),
        customer_message="Sim, pode pedir para retornar daqui a 5 minutos",
    )
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN
    assert decision.escalated is True


def test_reply_definitive_refusal_without_reschedule_wording_still_closes():
    """Recusa genuína (sem sinal de "voltar"/"retornar") continua fechando
    normalmente — a rede de segurança não deve virar escalação geral."""
    decision = decide_after_reply_classification(
        True,
        _reply_output(category=ReplyCategory.DEFINITIVE_REFUSAL, confidence=1.0),
        customer_message="Não quero mais receber, pode devolver pro remetente",
    )
    assert decision.next_state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE


def test_reply_new_address_requires_radius_check():
    decision = decide_after_reply_classification(
        True,
        _reply_output(category=ReplyCategory.REQUESTS_NEW_ADDRESS, new_address_text="Rua X, 123"),
    )
    assert decision.requires_radius_check is True
    assert decision.next_state is None
    assert decision.new_address_text == "Rua X, 123"


def test_reply_new_address_without_text_escalates():
    decision = decide_after_reply_classification(
        True, _reply_output(category=ReplyCategory.REQUESTS_NEW_ADDRESS, new_address_text=None)
    )
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN


def test_reply_ambiguous_category_escalates():
    decision = decide_after_reply_classification(
        True, _reply_output(category=ReplyCategory.AMBIGUOUS, is_ambiguous=True)
    )
    assert decision.next_state == OccurrenceState.ESCALATED_TO_HUMAN


def test_radius_within_closes_resolved():
    assert decide_after_radius_check(True) == OccurrenceState.CLOSED_RESOLVED


def test_radius_outside_closes_failed():
    assert decide_after_radius_check(False) == OccurrenceState.CLOSED_DEFINITIVE_FAILURE


def test_timeout_attempt_1_goes_to_attempt_2():
    assert decide_after_timeout(1) == OccurrenceState.CONTACTING_CUSTOMER_ATTEMPT_2


def test_timeout_attempt_2_closes_definitive():
    assert decide_after_timeout(2) == OccurrenceState.CLOSED_DEFINITIVE_FAILURE
