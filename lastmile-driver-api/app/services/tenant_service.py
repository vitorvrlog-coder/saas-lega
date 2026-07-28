"""
Provisionamento e gestão de tenants. Diferente do antigo gateway
evolution-go, a WhatsApp Cloud API (Meta) não expõe uma chamada de API pra
"criar" um número — o número é configurado manualmente no Meta Business
Manager (verificação, WABA, templates aprovados) e as credenciais
resultantes (phone_number_id + access_token) são só cadastradas aqui.
create_tenant portanto apenas persiste o tenant com as credenciais já
informadas, sem nenhuma chamada de rede.
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.ai_decision_log import AIDecisionLog
from app.db.models.driver import Driver
from app.db.models.message_log import MessageLog
from app.db.models.occurrence import Occurrence
from app.db.models.processed_event import ProcessedEvent
from app.db.models.route_manifest import RouteManifest
from app.db.models.tenant import Tenant
from app.integrations.whatsapp_cloud.client import WhatsAppCloudClient

logger = logging.getLogger(__name__)


class DuplicateTenantSlugError(Exception):
    pass


class TenantProvisioningError(Exception):
    pass


async def _slug_exists(db: AsyncSession, slug: str) -> bool:
    result = await db.execute(select(Tenant.id).where(Tenant.slug == slug))
    return result.scalar_one_or_none() is not None


def build_whatsapp_client(settings: Settings, tenant: Tenant) -> WhatsAppCloudClient:
    return WhatsAppCloudClient(
        phone_number_id=tenant.whatsapp_phone_number_id,
        access_token=tenant.whatsapp_access_token,
        api_version=settings.META_API_VERSION,
    )


async def create_tenant(
    db: AsyncSession,
    settings: Settings,
    *,
    name: str,
    slug: str,
    whatsapp_phone_number_id: str,
    whatsapp_access_token: str,
    allowed_radius_km: float,
    timeout_attempt_1_minutes: int,
    timeout_attempt_2_minutes: int,
    full_autonomous_mode: bool = False,
) -> Tenant:
    if await _slug_exists(db, slug):
        raise DuplicateTenantSlugError(f"Já existe um tenant com slug '{slug}'.")

    if not whatsapp_phone_number_id or not whatsapp_access_token:
        raise TenantProvisioningError(
            "É preciso informar phone_number_id e access_token da WhatsApp Cloud API "
            "(configurados previamente no Meta Business Manager)."
        )

    tenant = Tenant(
        name=name,
        slug=slug,
        whatsapp_phone_number_id=whatsapp_phone_number_id,
        whatsapp_access_token=whatsapp_access_token,
        allowed_radius_km=allowed_radius_km,
        timeout_attempt_1_minutes=timeout_attempt_1_minutes,
        timeout_attempt_2_minutes=timeout_attempt_2_minutes,
        full_autonomous_mode=full_autonomous_mode,
        message_templates={},
        whatsapp_template_names={},
    )
    db.add(tenant)
    await db.flush()
    return tenant


async def update_tenant(
    db: AsyncSession,
    tenant: Tenant,
    *,
    name: str | None = None,
    whatsapp_phone_number_id: str | None = None,
    whatsapp_access_token: str | None = None,
    allowed_radius_km: float | None = None,
    timeout_attempt_1_minutes: int | None = None,
    timeout_attempt_2_minutes: int | None = None,
    full_autonomous_mode: bool | None = None,
    message_templates: dict | None = None,
    whatsapp_template_names: dict | None = None,
) -> Tenant:
    if name is not None:
        tenant.name = name
    if whatsapp_phone_number_id is not None:
        tenant.whatsapp_phone_number_id = whatsapp_phone_number_id
    if whatsapp_access_token is not None:
        tenant.whatsapp_access_token = whatsapp_access_token
    if allowed_radius_km is not None:
        tenant.allowed_radius_km = allowed_radius_km
    if timeout_attempt_1_minutes is not None:
        tenant.timeout_attempt_1_minutes = timeout_attempt_1_minutes
    if timeout_attempt_2_minutes is not None:
        tenant.timeout_attempt_2_minutes = timeout_attempt_2_minutes
    if full_autonomous_mode is not None:
        tenant.full_autonomous_mode = full_autonomous_mode
    if message_templates is not None:
        tenant.message_templates = message_templates
    if whatsapp_template_names is not None:
        tenant.whatsapp_template_names = whatsapp_template_names

    await db.flush()
    return tenant


async def set_tenant_active(db: AsyncSession, tenant: Tenant, is_active: bool) -> Tenant:
    tenant.is_active = is_active
    await db.flush()
    return tenant


class TenantHasDataError(Exception):
    pass


async def delete_tenant(db: AsyncSession, settings: Settings, tenant: Tenant) -> None:
    """Remove definitivamente um tenant. Recusa se já existe QUALQUER
    ocorrência, planilha de rota ou motorista registrado — occurrences,
    message_logs, ai_decision_logs, processed_events, route_manifests e
    drivers referenciam tenant_id com ON DELETE RESTRICT de propósito (ver
    migrations), então essa checagem antecipa esse erro (senão vira
    IntegrityError não tratada = 500) com uma mensagem legível pro
    operador. "Remover" aqui é pra tenant cadastrado por engano/nunca
    usado — tenant com operação real deve ser Desativado (toggle-active),
    não removido."""
    has_data = (
        await db.execute(
            select(
                select(Occurrence.id).where(Occurrence.tenant_id == tenant.id).exists()
                | select(RouteManifest.id).where(RouteManifest.tenant_id == tenant.id).exists()
                | select(Driver.id).where(Driver.tenant_id == tenant.id).exists()
                | select(MessageLog.id).where(MessageLog.tenant_id == tenant.id).exists()
                | select(AIDecisionLog.id).where(AIDecisionLog.tenant_id == tenant.id).exists()
                | select(ProcessedEvent.id).where(ProcessedEvent.tenant_id == tenant.id).exists()
            )
        )
    ).scalar_one()
    if has_data:
        raise TenantHasDataError(
            "Este tenant já tem ocorrências, mensagens, decisões de IA, planilhas de rota ou motoristas "
            "registrados — não pode ser removido. Use 'Desativar' pra impedir novo uso sem perder o histórico."
        )

    await db.delete(tenant)
    await db.flush()


async def get_tenant_connection_status(settings: Settings, tenant: Tenant) -> dict | str:
    """GET /{phone_number_id} na Graph API — retorna verified_name e
    quality_rating do número, informativo pra tela de administração. Não
    existe mais conceito de "conectado/desconectado" (sessão de app
    pessoal) nem QR code — o número fica disponível enquanto o
    access_token for válido."""
    client = build_whatsapp_client(settings, tenant)
    return await client.get_status()
