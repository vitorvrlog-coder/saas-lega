"""
Provisionamento e gestão de tenants. Criar um tenant não é só inserir uma
linha na tabela: envolve criar a instância correspondente no gateway
evolution-go e conectá-la ao nosso webhook — sem isso o tenant fica sem
WhatsApp funcional. Por isso create_tenant só persiste no banco depois que
o provisionamento no gateway deu certo (evita tenant "órfão").
"""
import logging
import secrets

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
from app.integrations.evolution_api.client import (
    EvolutionAPIError,
    EvolutionClient,
    create_evolution_instance,
    delete_evolution_instance,
)

logger = logging.getLogger(__name__)


class DuplicateTenantSlugError(Exception):
    pass


class TenantProvisioningError(Exception):
    pass


async def _slug_exists(db: AsyncSession, slug: str) -> bool:
    result = await db.execute(select(Tenant.id).where(Tenant.slug == slug))
    return result.scalar_one_or_none() is not None


def build_evolution_client(settings: Settings, tenant: Tenant) -> EvolutionClient:
    return EvolutionClient(
        base_url=settings.EVOLUTION_BASE_URL,
        instance=tenant.evolution_instance,
        token=tenant.evolution_token,
    )


async def create_tenant(
    db: AsyncSession,
    settings: Settings,
    *,
    name: str,
    slug: str,
    allowed_radius_km: float,
    timeout_attempt_1_minutes: int,
    timeout_attempt_2_minutes: int,
) -> Tenant:
    if await _slug_exists(db, slug):
        raise DuplicateTenantSlugError(f"Já existe um tenant com slug '{slug}'.")

    if not settings.EVOLUTION_GLOBAL_API_KEY:
        raise TenantProvisioningError(
            "EVOLUTION_GLOBAL_API_KEY não configurada — não é possível provisionar instância."
        )

    # Slug dobra de nome da instância no gateway (único, legível, já
    # validado como único acima) — evita mais um identificador pra gerir.
    evolution_instance = slug
    evolution_token = secrets.token_hex(16)

    try:
        await create_evolution_instance(
            base_url=settings.EVOLUTION_BASE_URL,
            global_api_key=settings.EVOLUTION_GLOBAL_API_KEY,
            name=evolution_instance,
            token=evolution_token,
        )
    except Exception as exc:
        logger.error("Falha ao criar instância evolution-go para tenant '%s': %s", slug, exc)
        raise TenantProvisioningError(
            f"Falha ao criar instância no gateway WhatsApp: {exc}"
        ) from exc

    client = EvolutionClient(
        base_url=settings.EVOLUTION_BASE_URL, instance=evolution_instance, token=evolution_token
    )
    webhook_url = f"{settings.WEBHOOK_BASE_URL}/api/v1/webhooks/evolution"
    try:
        await client.connect(webhook_url)
    except Exception as exc:
        logger.error("Instância '%s' criada mas connect() falhou: %s", slug, exc)
        raise TenantProvisioningError(
            f"Instância criada no gateway, mas falhou ao conectar o webhook: {exc}"
        ) from exc

    tenant = Tenant(
        name=name,
        slug=slug,
        evolution_instance=evolution_instance,
        evolution_token=evolution_token,
        allowed_radius_km=allowed_radius_km,
        timeout_attempt_1_minutes=timeout_attempt_1_minutes,
        timeout_attempt_2_minutes=timeout_attempt_2_minutes,
        message_templates={},
    )
    db.add(tenant)
    await db.flush()
    return tenant


async def update_tenant(
    db: AsyncSession,
    tenant: Tenant,
    *,
    name: str | None = None,
    allowed_radius_km: float | None = None,
    timeout_attempt_1_minutes: int | None = None,
    timeout_attempt_2_minutes: int | None = None,
    message_templates: dict | None = None,
) -> Tenant:
    if name is not None:
        tenant.name = name
    if allowed_radius_km is not None:
        tenant.allowed_radius_km = allowed_radius_km
    if timeout_attempt_1_minutes is not None:
        tenant.timeout_attempt_1_minutes = timeout_attempt_1_minutes
    if timeout_attempt_2_minutes is not None:
        tenant.timeout_attempt_2_minutes = timeout_attempt_2_minutes
    if message_templates is not None:
        tenant.message_templates = message_templates

    await db.flush()
    return tenant


async def set_tenant_active(db: AsyncSession, tenant: Tenant, is_active: bool) -> Tenant:
    tenant.is_active = is_active
    await db.flush()
    return tenant


class TenantHasDataError(Exception):
    pass


async def delete_tenant(db: AsyncSession, settings: Settings, tenant: Tenant) -> None:
    """Remove definitivamente um tenant (linha + instância no gateway).
    Recusa se já existe QUALQUER ocorrência, planilha de rota ou motorista
    registrado — occurrences, message_logs, ai_decision_logs,
    processed_events, route_manifests e drivers referenciam tenant_id com
    ON DELETE RESTRICT de propósito (ver migrations), então essa checagem
    antecipa esse erro (senão vira IntegrityError não tratada = 500) com
    uma mensagem legível pro operador. "Remover" aqui é pra tenant
    cadastrado por engano/nunca usado — tenant com operação real deve ser
    Desativado (toggle-active), não removido."""
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

    if settings.EVOLUTION_GLOBAL_API_KEY:
        try:
            await delete_evolution_instance(
                base_url=settings.EVOLUTION_BASE_URL,
                global_api_key=settings.EVOLUTION_GLOBAL_API_KEY,
                name=tenant.evolution_instance,
            )
        except Exception as exc:
            logger.warning(
                "Falha ao apagar instância '%s' do gateway ao remover tenant (seguindo com a remoção do tenant): %s",
                tenant.evolution_instance, exc,
            )

    await db.delete(tenant)
    await db.flush()


async def reconnect_tenant_whatsapp(settings: Settings, tenant: Tenant) -> None:
    """Destrava uma instância que "morreu sozinha" no gateway (celular
    desconectou/desvinculou e as rotas normais de status/reconnect/logout
    passam a falhar com "client disconnected" indefinidamente — confirmado
    testando contra o gateway real). Apaga e recria a instância com o MESMO
    nome e token já salvos no tenant (não muda nada no nosso banco), então
    reconecta ao webhook — depois disso get_tenant_qr() volta a funcionar."""
    if not settings.EVOLUTION_GLOBAL_API_KEY:
        raise TenantProvisioningError(
            "EVOLUTION_GLOBAL_API_KEY não configurada — não é possível recriar a instância."
        )

    try:
        await delete_evolution_instance(
            base_url=settings.EVOLUTION_BASE_URL,
            global_api_key=settings.EVOLUTION_GLOBAL_API_KEY,
            name=tenant.evolution_instance,
        )
    except Exception as exc:
        logger.error("Falha ao apagar instância '%s' pra reconectar: %s", tenant.evolution_instance, exc)
        raise TenantProvisioningError(f"Falha ao apagar instância travada: {exc}") from exc

    try:
        await create_evolution_instance(
            base_url=settings.EVOLUTION_BASE_URL,
            global_api_key=settings.EVOLUTION_GLOBAL_API_KEY,
            name=tenant.evolution_instance,
            token=tenant.evolution_token,
        )
    except Exception as exc:
        logger.error("Falha ao recriar instância '%s': %s", tenant.evolution_instance, exc)
        raise TenantProvisioningError(f"Instância apagada mas falhou ao recriar: {exc}") from exc

    client = build_evolution_client(settings, tenant)
    webhook_url = f"{settings.WEBHOOK_BASE_URL}/api/v1/webhooks/evolution"
    try:
        await client.connect(webhook_url)
    except Exception as exc:
        logger.error("Instância '%s' recriada mas connect() falhou: %s", tenant.evolution_instance, exc)
        raise TenantProvisioningError(
            f"Instância recriada, mas falhou ao conectar o webhook: {exc}"
        ) from exc


async def get_tenant_qr(settings: Settings, tenant: Tenant) -> dict | str:
    """QR expira em ~40s no evolution-go — cada chamada pede um novo,
    quem decide a cadência de polling é o chamador (rota web)."""
    client = build_evolution_client(settings, tenant)
    return await client.get_qr()


async def get_tenant_connection_status(settings: Settings, tenant: Tenant) -> dict | str:
    client = build_evolution_client(settings, tenant)
    return await client.get_status()


async def get_tenant_connection_view(settings: Settings, tenant: Tenant) -> dict:
    """Junta status + QR pra tela de pareamento, absorvendo uma corrida real
    confirmada nos logs do gateway: logo após o celular escanear o QR, o
    WhatsApp força uma reconexão interna (código 515) — nesse intervalo
    curtíssimo, /instance/status ainda responde LoggedIn=false (autenticação
    em andamento), então a gente pedia um QR novo, e o gateway rejeitava com
    400 porque a instância JÁ estava pareada. Isso derrubava uma sessão que
    tinha acabado de conectar com sucesso pra "stuck_disconnected", expondo
    o botão destrutivo "Reconectar" (apaga e recria a instância) bem no
    momento em que reconectar era a última coisa necessária — confirmado
    como causa real dos pareamentos que "não duravam", contra o log real do
    evolution-go (delete/create/connect minutos depois de um "Successfully
    paired"). Por isso, se o pedido de QR falhar, a gente sempre reconsulta
    o status antes de declarar stuck: se virou LoggedIn nesse meio tempo,
    trata como conectado."""
    status: dict = {}
    qr_data_url: str | None = None
    error: str | None = None
    stuck_disconnected = False

    try:
        status_result = await get_tenant_connection_status(settings, tenant)
        status = status_result.get("data", {}) if isinstance(status_result, dict) else {}
    except EvolutionAPIError as exc:
        error = f"Gateway retornou erro: {exc}"
        stuck_disconnected = True

    if not status.get("LoggedIn"):
        try:
            qr_result = await get_tenant_qr(settings, tenant)
            qr_payload = qr_result.get("data", {}) if isinstance(qr_result, dict) else {}
            qr_data_url = qr_payload.get("Qrcode")
        except EvolutionAPIError as exc:
            try:
                recheck_result = await get_tenant_connection_status(settings, tenant)
                recheck_status = (
                    recheck_result.get("data", {}) if isinstance(recheck_result, dict) else {}
                )
            except EvolutionAPIError:
                recheck_status = {}

            if recheck_status.get("LoggedIn"):
                status = recheck_status
            else:
                error = f"Gateway retornou erro: {exc}"
                stuck_disconnected = True

    return {
        "status": status, "qr_data_url": qr_data_url,
        "error": error, "stuck_disconnected": stuck_disconnected,
    }
