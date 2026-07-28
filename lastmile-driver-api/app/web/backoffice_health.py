"""
Painel de saúde dos tenants (backoffice) — status da conexão WhatsApp de
cada transportadora + volume de mensagens/IA nas últimas 24h. As N chamadas
HTTP pro gateway evolution-go rodam em paralelo (asyncio.gather com
return_exceptions=True) pra uma instância fora do ar não travar o painel
inteiro nem serializar N round-trips de rede.
"""
import asyncio
import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.ai_decision_log import AIDecisionLog
from app.db.models.message_log import MessageLog
from app.db.models.tenant import Tenant
from app.integrations.evolution_api.client import EvolutionAPIError
from app.services.tenant_service import get_tenant_connection_status

HEALTH_WINDOW_HOURS = 24


@dataclass
class TenantHealthRow:
    tenant: Tenant
    whatsapp_connected: bool | None  # None = não deu pra checar (erro no gateway)
    whatsapp_error: str | None
    message_count_24h: int
    ai_decision_count_24h: int
    ai_invalid_schema_count_24h: int
    ai_escalated_count_24h: int


@dataclass
class BackofficeHealth:
    rows: list[TenantHealthRow]
    window_hours: int


async def _check_connection(settings: Settings, tenant: Tenant) -> tuple[bool | None, str | None]:
    try:
        result = await get_tenant_connection_status(settings, tenant)
    except EvolutionAPIError as exc:
        return None, f"Gateway retornou erro: {exc}"
    data = result.get("data", {}) if isinstance(result, dict) else {}
    return bool(data.get("LoggedIn")), None


async def get_tenant_health(db: AsyncSession, settings: Settings) -> BackofficeHealth:
    tenants = (await db.execute(select(Tenant).where(Tenant.is_active.is_(True)).order_by(Tenant.name))).scalars().all()

    connection_results = await asyncio.gather(
        *(_check_connection(settings, tenant) for tenant in tenants),
        return_exceptions=True,
    )

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=HEALTH_WINDOW_HOURS)

    message_counts = dict(
        (
            await db.execute(
                select(MessageLog.tenant_id, func.count())
                .where(MessageLog.created_at >= since)
                .group_by(MessageLog.tenant_id)
            )
        ).all()
    )

    ai_counts = (
        await db.execute(
            select(
                AIDecisionLog.tenant_id,
                func.count(),
                func.count().filter(AIDecisionLog.is_valid_schema.is_(False)),
                func.count().filter(AIDecisionLog.escalated_to_human.is_(True)),
            )
            .where(AIDecisionLog.created_at >= since)
            .group_by(AIDecisionLog.tenant_id)
        )
    ).all()
    ai_counts_by_tenant: dict[uuid.UUID, tuple[int, int, int]] = {
        tenant_id: (total, invalid, escalated) for tenant_id, total, invalid, escalated in ai_counts
    }

    rows = []
    for tenant, connection_result in zip(tenants, connection_results):
        if isinstance(connection_result, BaseException):
            whatsapp_connected, whatsapp_error = None, f"Erro inesperado: {connection_result}"
        else:
            whatsapp_connected, whatsapp_error = connection_result

        ai_total, ai_invalid, ai_escalated = ai_counts_by_tenant.get(tenant.id, (0, 0, 0))
        rows.append(
            TenantHealthRow(
                tenant=tenant,
                whatsapp_connected=whatsapp_connected,
                whatsapp_error=whatsapp_error,
                message_count_24h=message_counts.get(tenant.id, 0),
                ai_decision_count_24h=ai_total,
                ai_invalid_schema_count_24h=ai_invalid,
                ai_escalated_count_24h=ai_escalated,
            )
        )

    return BackofficeHealth(rows=rows, window_hours=HEALTH_WINDOW_HOURS)
