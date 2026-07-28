"""
Assinatura paga do motorista no app low ticket ("adesão") — o motorista
paga direto (não a transportadora), via Asaas (PIX ou cartão, motorista
escolhe no checkout). Uma DriverSubscription por Driver; status
atualizado por webhook (ver receive_asaas_webhook em app.api.v1.webhooks).

Cadastro (Driver) e adesão (DriverSubscription) são desacoplados de
propósito: um motorista pode existir sem nunca ter assinado, e só faz
sentido iniciar cobrança pra quem já está vinculado a uma transportadora
(o link de pagamento é enviado por WhatsApp, que depende do número
Business da tenant — motorista órfão não tem como receber)."""
import datetime
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.driver import Driver
from app.db.models.driver_subscription import DriverSubscription
from app.db.models.enums import DriverSubscriptionStatus
from app.db.models.tenant import Tenant
from app.integrations.asaas.client import AsaasClient
from app.services.message_templates import SUBSCRIPTION_PAYMENT_LINK, render_template
from app.services.occurrence_service import evolution_client_for, send_text_message

logger = logging.getLogger(__name__)


class DriverNotLinkedError(Exception):
    """Motorista sem transportadora vinculada — não tem como receber o
    link de pagamento (depende do WhatsApp Business da tenant)."""


class DriverMissingCPFError(Exception):
    """Asaas exige CPF pra criar o customer — sem isso não dá pra cobrar."""


class SubscriptionAlreadyExistsError(Exception):
    """Motorista já tem uma DriverSubscription — usar renovação/consulta,
    não criar outra."""


def _asaas_client(settings: Settings) -> AsaasClient:
    if not settings.ASAAS_API_KEY:
        raise RuntimeError("ASAAS_API_KEY não configurado — defina no .env antes de iniciar cobrança.")
    return AsaasClient(api_key=settings.ASAAS_API_KEY, base_url=settings.ASAAS_BASE_URL)


async def get_subscription(db: AsyncSession, driver_id: uuid.UUID) -> DriverSubscription | None:
    result = await db.execute(select(DriverSubscription).where(DriverSubscription.driver_id == driver_id))
    return result.scalars().first()


async def get_subscriptions_by_driver(
    db: AsyncSession, driver_ids: list[uuid.UUID]
) -> dict[uuid.UUID, DriverSubscription]:
    if not driver_ids:
        return {}
    result = await db.execute(select(DriverSubscription).where(DriverSubscription.driver_id.in_(driver_ids)))
    return {sub.driver_id: sub for sub in result.scalars().all()}


async def start_subscription(
    db: AsyncSession, settings: Settings, tenant: Tenant, driver: Driver
) -> DriverSubscription:
    """Cria (ou reaproveita) o customer no Asaas, abre a 1ª cobrança da
    assinatura recorrente, salva localmente e manda o link de pagamento
    por WhatsApp. Levanta erro cedo (antes de qualquer chamada ao Asaas)
    se faltar CPF ou transportadora — mensagens de negócio claras em vez
    de deixar o Asaas rejeitar com erro genérico de payload."""
    if driver.tenant_id is None:
        raise DriverNotLinkedError(
            "Este motorista não tem transportadora vinculada — vincule antes de iniciar a cobrança "
            "(o link de pagamento é enviado pelo WhatsApp Business dela)."
        )
    if not driver.cpf:
        raise DriverMissingCPFError("Este motorista não tem CPF cadastrado — obrigatório pro Asaas criar a cobrança.")

    existing = await get_subscription(db, driver.id)
    if existing is not None:
        raise SubscriptionAlreadyExistsError("Este motorista já tem uma assinatura registrada.")

    client = _asaas_client(settings)

    customer = await client.find_customer_by_cpf(driver.cpf)
    if customer is None:
        customer = await client.create_customer(name=driver.name or driver.phone, cpf=driver.cpf, phone=driver.phone)
    customer_id = customer["id"]

    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    subscription_response = await client.create_subscription(
        customer_id=customer_id,
        value=settings.DRIVER_SUBSCRIPTION_VALUE,
        next_due_date=tomorrow,
        billing_type="UNDEFINED",
    )

    subscription = DriverSubscription(
        driver_id=driver.id,
        asaas_customer_id=customer_id,
        asaas_subscription_id=subscription_response.get("id"),
        status=DriverSubscriptionStatus.PENDING,
        value=settings.DRIVER_SUBSCRIPTION_VALUE,
        billing_type="UNDEFINED",
        next_due_date=datetime.date.fromisoformat(tomorrow),
        checkout_url=subscription_response.get("invoiceUrl") or subscription_response.get("paymentLink"),
    )
    db.add(subscription)
    await db.flush()

    if subscription.checkout_url:
        text = render_template(
            tenant, SUBSCRIPTION_PAYMENT_LINK,
            value=f"{settings.DRIVER_SUBSCRIPTION_VALUE:.2f}", payment_link=subscription.checkout_url,
        )
        if text:
            wa_client = evolution_client_for(tenant, settings)
            await send_text_message(
                db, wa_client, tenant, SUBSCRIPTION_PAYMENT_LINK, driver.phone, text,
                value=f"{settings.DRIVER_SUBSCRIPTION_VALUE:.2f}", payment_link=subscription.checkout_url,
            )
        else:
            logger.warning(
                "Tenant %s sem template '%s' configurado — link de pagamento não enviado por WhatsApp, "
                "só salvo em checkout_url.", tenant.slug, SUBSCRIPTION_PAYMENT_LINK,
            )

    return subscription


_STATUS_BY_EVENT = {
    "PAYMENT_CONFIRMED": DriverSubscriptionStatus.ACTIVE,
    "PAYMENT_RECEIVED": DriverSubscriptionStatus.ACTIVE,
    "PAYMENT_OVERDUE": DriverSubscriptionStatus.OVERDUE,
}
_CANCEL_EVENTS = {"SUBSCRIPTION_DELETED", "PAYMENT_DELETED"}


async def handle_webhook_event(db: AsyncSession, payload: dict) -> DriverSubscription | None:
    """Aplica o evento do Asaas na DriverSubscription correspondente —
    identificada pelo asaas_subscription_id, presente tanto em eventos de
    PAYMENT_* (dentro de payload["payment"]["subscription"]) quanto de
    SUBSCRIPTION_* (payload["subscription"]["id"]). Evento não reconhecido
    ou sem subscription_id associado é ignorado (logado, não é erro —
    mesmo princípio do webhook da Meta: nunca falhar o request por evento
    que não sabemos tratar)."""
    event = payload.get("event")
    if not event:
        return None

    subscription_id = (
        payload.get("payment", {}).get("subscription")
        or payload.get("subscription", {}).get("id")
    )
    if not subscription_id:
        logger.info("Webhook Asaas evento=%s sem subscription id associado, ignorado.", event)
        return None

    result = await db.execute(
        select(DriverSubscription).where(DriverSubscription.asaas_subscription_id == subscription_id)
    )
    subscription = result.scalars().first()
    if subscription is None:
        logger.warning("Webhook Asaas evento=%s pra subscription desconhecida: %s", event, subscription_id)
        return None

    if event in _CANCEL_EVENTS:
        subscription.status = DriverSubscriptionStatus.CANCELED
        subscription.canceled_at = datetime.datetime.now(datetime.timezone.utc)
    elif event in _STATUS_BY_EVENT:
        subscription.status = _STATUS_BY_EVENT[event]
        next_due = payload.get("payment", {}).get("nextDueDate")
        if next_due:
            subscription.next_due_date = datetime.date.fromisoformat(next_due)
    else:
        logger.info("Webhook Asaas evento=%s não mapeado, ignorado (subscription=%s).", event, subscription_id)
        return subscription

    logger.info(
        "Webhook Asaas processado: evento=%s subscription=%s novo_status=%s",
        event, subscription_id, subscription.status.value,
    )
    return subscription
