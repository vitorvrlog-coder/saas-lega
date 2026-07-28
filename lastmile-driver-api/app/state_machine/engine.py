"""
Único ponto do sistema que muda o estado de uma Occurrence. Garante duas
coisas ao mesmo tempo: (1) a transição é legal (app.state_machine.states),
(2) toda mudança de estado é registrada em state_transitions (append-only,
auditoria para disputa comercial/jurídica) — as duas coisas sempre juntas,
nunca uma sem a outra.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import OccurrenceState, TransitionActor
from app.db.models.occurrence import Occurrence
from app.db.models.state_transition import StateTransition
from app.state_machine.states import is_valid_transition


class InvalidTransitionError(Exception):
    def __init__(self, from_state: OccurrenceState, to_state: OccurrenceState):
        self.from_state = from_state
        self.to_state = to_state
        super().__init__(f"Transição inválida: {from_state.value} -> {to_state.value}")


async def transition(
    db: AsyncSession,
    occurrence: Occurrence,
    to_state: OccurrenceState,
    triggered_by: TransitionActor,
    reason: str | None = None,
    context: dict | None = None,
) -> Occurrence:
    from_state = occurrence.state

    if not is_valid_transition(from_state, to_state):
        raise InvalidTransitionError(from_state, to_state)

    occurrence.state = to_state
    db.add(occurrence)
    db.add(
        StateTransition(
            occurrence_id=occurrence.id,
            from_state=from_state,
            to_state=to_state,
            triggered_by=triggered_by,
            reason=reason,
            context=context,
        )
    )
    await db.flush()
    return occurrence
