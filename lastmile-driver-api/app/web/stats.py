"""Agregações pro dashboard (KPIs + gráfico de volume diário). Só leitura,
não faz parte do motor de estados — puramente para exibição."""
import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import OccurrenceState
from app.db.models.occurrence import Occurrence

DAILY_CHART_DAYS = 14


@dataclass
class DashboardStats:
    pending_human_queue: int
    awaiting_customer_reply: int
    escalated_open: int
    resolved_today: int
    failed_today: int
    total_today: int
    daily_labels: list[str]
    daily_counts: list[int]
    reason_labels: list[str]
    reason_counts: list[int]


async def get_dashboard_stats(db: AsyncSession, tenant_id: uuid.UUID | None = None) -> DashboardStats:
    """tenant_id=None mostra o agregado de todos os tenants (só pra admin
    da plataforma) — operador comum sempre passa o próprio tenant_id."""
    now = datetime.datetime.now(datetime.timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def _tenant_conditions() -> tuple:
        return (Occurrence.tenant_id == tenant_id,) if tenant_id is not None else ()

    async def _count(*conditions) -> int:
        result = await db.execute(
            select(func.count()).select_from(Occurrence).where(*conditions, *_tenant_conditions())
        )
        return result.scalar_one()

    pending_human_queue = await _count(Occurrence.state == OccurrenceState.PENDING_HUMAN_QUEUE)
    awaiting_customer_reply = await _count(
        Occurrence.state.in_(
            [OccurrenceState.AWAITING_CUSTOMER_REPLY_1, OccurrenceState.AWAITING_CUSTOMER_REPLY_2]
        )
    )
    escalated_open = await _count(Occurrence.state == OccurrenceState.ESCALATED_TO_HUMAN)
    resolved_today = await _count(
        Occurrence.state == OccurrenceState.CLOSED_RESOLVED, Occurrence.closed_at >= today_start
    )
    failed_today = await _count(
        Occurrence.state == OccurrenceState.CLOSED_DEFINITIVE_FAILURE,
        Occurrence.closed_at >= today_start,
    )
    total_today = await _count(Occurrence.created_at >= today_start)

    since = today_start - datetime.timedelta(days=DAILY_CHART_DAYS - 1)
    daily_rows = (
        await db.execute(
            select(cast(Occurrence.created_at, Date).label("day"), func.count().label("n"))
            .where(Occurrence.created_at >= since, *_tenant_conditions())
            .group_by("day")
            .order_by("day")
        )
    ).all()
    daily_by_date = {row.day: row.n for row in daily_rows}
    daily_labels = []
    daily_counts = []
    for i in range(DAILY_CHART_DAYS):
        day = (since + datetime.timedelta(days=i)).date()
        daily_labels.append(day.strftime("%d/%m"))
        daily_counts.append(daily_by_date.get(day, 0))

    reason_rows = (
        await db.execute(
            select(Occurrence.failure_reason, func.count())
            .where(Occurrence.failure_reason.isnot(None), *_tenant_conditions())
            .group_by(Occurrence.failure_reason)
            .order_by(func.count().desc())
        )
    ).all()
    reason_labels = [r[0].value for r in reason_rows]
    reason_counts = [r[1] for r in reason_rows]

    return DashboardStats(
        pending_human_queue=pending_human_queue,
        awaiting_customer_reply=awaiting_customer_reply,
        escalated_open=escalated_open,
        resolved_today=resolved_today,
        failed_today=failed_today,
        total_today=total_today,
        daily_labels=daily_labels,
        daily_counts=daily_counts,
        reason_labels=reason_labels,
        reason_counts=reason_counts,
    )
