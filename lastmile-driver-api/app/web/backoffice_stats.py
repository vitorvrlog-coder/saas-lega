"""
Agregações pra visão geral do backoffice (uso interno Heimdall, não da
transportadora) — volume de ocorrências, taxa de resolvido/insucesso/
escalado e operadores ativos POR tenant, além de quais tenants foram
criados recentemente. Só leitura, 3 queries no total (não N+1 por tenant),
mais 2 queries pro bloco de motoristas assinantes (produto low ticket).
"""
import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver import Driver
from app.db.models.driver_login_code import DriverLoginCode
from app.db.models.driver_subscription import DriverSubscription
from app.db.models.enums import DriverSubscriptionStatus, OccurrenceState
from app.db.models.occurrence import Occurrence
from app.db.models.tenant import Tenant
from app.db.models.user import User

RECENT_TENANT_DAYS = 7


@dataclass
class TenantOverviewRow:
    tenant: Tenant
    occurrence_count: int
    resolved_count: int
    failed_count: int
    escalated_count: int
    active_operator_count: int

    @property
    def resolution_rate(self) -> float | None:
        """None quando não há nenhuma ocorrência FECHADA ainda (escalada
        não conta como fechada) — evita sugerir 0% quando na verdade não
        há dado suficiente pra calcular nada."""
        closed = self.resolved_count + self.failed_count
        if closed == 0:
            return None
        return self.resolved_count / closed


@dataclass
class DriverOverview:
    """Motoristas do produto low ticket (app de nota fiscal), agregados de
    todas as transportadoras — mesma definição de "assinante" usada na aba
    global /backoffice/drivers (ver driver_service.list_subscriber_drivers_with_tenant):
    tenant com preventive_contact_enabled=True E já logou no app pelo menos
    uma vez. Contagem de assinatura paga (DriverSubscription) é independente
    disso — um motorista pode ser "assinante" de uso sem ter aderido à
    cobrança ainda (fica PENDING/sem linha nenhuma)."""
    subscriber_driver_count: int
    unlinked_driver_count: int
    active_subscription_count: int
    overdue_subscription_count: int
    pending_subscription_count: int


@dataclass
class BackofficeOverview:
    active_tenant_count: int
    total_tenant_count: int
    recent_tenants: list[Tenant]
    rows: list[TenantOverviewRow]
    drivers: DriverOverview


async def get_backoffice_overview(db: AsyncSession) -> BackofficeOverview:
    tenants = (await db.execute(select(Tenant).order_by(Tenant.name))).scalars().all()
    active_tenant_count = sum(1 for t in tenants if t.is_active)

    since_recent = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=RECENT_TENANT_DAYS)
    recent_tenants = sorted(
        (t for t in tenants if t.created_at >= since_recent),
        key=lambda t: t.created_at, reverse=True,
    )

    state_counts = (
        await db.execute(
            select(Occurrence.tenant_id, Occurrence.state, func.count())
            .group_by(Occurrence.tenant_id, Occurrence.state)
        )
    ).all()
    counts_by_tenant: dict[uuid.UUID, dict[OccurrenceState, int]] = {}
    for tenant_id, state, n in state_counts:
        counts_by_tenant.setdefault(tenant_id, {})[state] = n

    operator_counts = (
        await db.execute(
            select(User.tenant_id, func.count())
            .where(User.is_active.is_(True), User.tenant_id.isnot(None))
            .group_by(User.tenant_id)
        )
    ).all()
    operators_by_tenant = dict(operator_counts)

    rows = [
        TenantOverviewRow(
            tenant=tenant,
            occurrence_count=sum(counts_by_tenant.get(tenant.id, {}).values()),
            resolved_count=counts_by_tenant.get(tenant.id, {}).get(OccurrenceState.CLOSED_RESOLVED, 0),
            failed_count=counts_by_tenant.get(tenant.id, {}).get(OccurrenceState.CLOSED_DEFINITIVE_FAILURE, 0),
            escalated_count=counts_by_tenant.get(tenant.id, {}).get(OccurrenceState.ESCALATED_TO_HUMAN, 0),
            active_operator_count=operators_by_tenant.get(tenant.id, 0),
        )
        for tenant in tenants
    ]

    return BackofficeOverview(
        active_tenant_count=active_tenant_count,
        total_tenant_count=len(tenants),
        recent_tenants=recent_tenants,
        rows=rows,
        drivers=await get_driver_overview(db),
    )


async def get_driver_overview(db: AsyncSession) -> DriverOverview:
    subscriber_count = (
        await db.execute(
            select(func.count())
            .select_from(Driver)
            .join(Tenant, Tenant.id == Driver.tenant_id)
            .where(
                Tenant.preventive_contact_enabled.is_(True),
                select(DriverLoginCode.id)
                .where(DriverLoginCode.driver_id == Driver.id, DriverLoginCode.used_at.is_not(None))
                .exists(),
            )
        )
    ).scalar_one()

    unlinked_count = (
        await db.execute(select(func.count()).select_from(Driver).where(Driver.tenant_id.is_(None)))
    ).scalar_one()

    subscription_counts = dict(
        (
            await db.execute(select(DriverSubscription.status, func.count()).group_by(DriverSubscription.status))
        ).all()
    )

    return DriverOverview(
        subscriber_driver_count=subscriber_count,
        unlinked_driver_count=unlinked_count,
        active_subscription_count=subscription_counts.get(DriverSubscriptionStatus.ACTIVE, 0),
        overdue_subscription_count=subscription_counts.get(DriverSubscriptionStatus.OVERDUE, 0),
        pending_subscription_count=subscription_counts.get(DriverSubscriptionStatus.PENDING, 0),
    )
