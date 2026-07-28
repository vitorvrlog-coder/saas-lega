"""
Recebe o webhook da WhatsApp Cloud API (Meta). Sempre responde 200 no POST
(mesmo para eventos ignorados/duplicados/tenant desconhecido) — é um
webhook, não uma API de negócio: devolver erro faria a Meta reenviar o
mesmo evento, piorando exatamente o cenário de duplicação que a
idempotência já cobre.
"""
import hashlib
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.integrations.whatsapp_cloud.webhook_parser import (
    parse_inbound_webhook,
    parse_receipt_webhook,
)
from app.schemas.whatsapp_webhook import WhatsAppWebhookPayload
from app.services import driver_subscription_service, occurrence_service
from app.services.idempotency_service import is_duplicate_event

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/webhooks/whatsapp")
async def verify_whatsapp_webhook(
    hub_mode: str = Query(alias="hub.mode"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
    settings: Settings = Depends(get_settings),
):
    """Handshake único, disparado pela Meta ao cadastrar o webhook no
    painel do app — sem responder o challenge corretamente, a Meta recusa
    salvar a URL."""
    if hub_mode != "subscribe" or hub_verify_token != settings.META_WEBHOOK_VERIFY_TOKEN:
        raise HTTPException(status_code=403, detail="Verify token inválido.")
    return int(hub_challenge)


def _verify_signature(raw_body: bytes, signature_header: str | None, app_secret: str) -> bool:
    """Confirma que o payload realmente veio da Meta — sem isso, qualquer
    um que descubra a URL do webhook poderia forjar eventos (mensagem
    inbound falsa, status de entrega falso)."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    received = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)


@router.post("/webhooks/whatsapp")
async def receive_whatsapp_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    raw_body = await request.body()

    if settings.META_APP_SECRET and not _verify_signature(
        raw_body, request.headers.get("X-Hub-Signature-256"), settings.META_APP_SECRET
    ):
        logger.warning("Webhook com assinatura inválida, rejeitado.")
        raise HTTPException(status_code=403, detail="Assinatura inválida.")

    raw_payload = await request.json()
    logger.info("Webhook recebido: %s", raw_payload)

    try:
        payload = WhatsAppWebhookPayload.model_validate(raw_payload)
    except ValidationError as exc:
        logger.warning("Payload de webhook não reconhecido, ignorado: erro=%s payload=%s", exc, raw_payload)
        return {"status": "ignored"}

    for parsed in parse_inbound_webhook(payload, raw_payload):
        await _handle_inbound(db, settings, parsed)

    for parsed_receipt in parse_receipt_webhook(payload):
        await _handle_receipt(db, parsed_receipt)

    return {"status": "ok"}


async def _handle_inbound(db: AsyncSession, settings: Settings, parsed) -> None:
    tenant = await occurrence_service.get_tenant_by_phone_number_id(db, parsed.phone_number_id)
    if tenant is None:
        logger.warning("Webhook de phone_number_id desconhecido: %s", parsed.phone_number_id)
        return

    duplicate = await is_duplicate_event(db, tenant.id, parsed.external_message_id, "message")
    if duplicate:
        logger.info(
            "Webhook duplicado, ignorado: tenant=%s external_message_id=%s",
            tenant.id, parsed.external_message_id,
        )
        await db.commit()
        return

    logger.info(
        "Processando mensagem inbound: tenant=%s phone=%s external_message_id=%s content_type=%s",
        tenant.id, parsed.phone, parsed.external_message_id, parsed.content_type.value,
    )
    await occurrence_service.handle_inbound_message(db, settings, tenant, parsed)
    await db.commit()


@router.post("/webhooks/asaas")
async def receive_asaas_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Recebe eventos de cobrança do Asaas (PAYMENT_RECEIVED, PAYMENT_OVERDUE
    etc.) — atualiza o status da DriverSubscription correspondente. Mesmo
    princípio do webhook da Meta: sempre 200, pra não entrar em loop de
    reenvio do lado do Asaas em caso de evento não reconhecido."""
    if settings.ASAAS_WEBHOOK_TOKEN and request.headers.get("asaas-access-token") != settings.ASAAS_WEBHOOK_TOKEN:
        logger.warning("Webhook Asaas com token inválido, rejeitado.")
        raise HTTPException(status_code=403, detail="Token inválido.")

    payload = await request.json()
    logger.info("Webhook Asaas recebido: %s", payload)

    await driver_subscription_service.handle_webhook_event(db, payload)
    await db.commit()
    return {"status": "ok"}


async def _handle_receipt(db: AsyncSession, parsed) -> None:
    tenant = await occurrence_service.get_tenant_by_phone_number_id(db, parsed.phone_number_id)
    if tenant is None:
        logger.warning("Status de phone_number_id desconhecido: %s", parsed.phone_number_id)
        return

    updated = await occurrence_service.update_delivery_status(
        db, tenant.id, parsed.message_ids, parsed.status
    )
    logger.info(
        "Status processado: tenant=%s status=%s message_ids=%s linhas_atualizadas=%d",
        tenant.id, parsed.status, parsed.message_ids, updated,
    )
    await db.commit()
