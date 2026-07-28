"""
Recebe o webhook do gateway evolution-go. Sempre responde 200 (mesmo para
eventos ignorados/duplicados/tenant desconhecido) — é um webhook, não uma
API de negócio: devolver erro faria o gateway reenviar o mesmo evento,
piorando exatamente o cenário de duplicação que a idempotência já cobre.
"""
import logging

from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.integrations.evolution_api.webhook_parser import (
    parse_inbound_webhook,
    parse_receipt_webhook,
)
from app.schemas.evolution_webhook import EvolutionReceiptPayload, EvolutionWebhookPayload
from app.services import occurrence_service
from app.services.idempotency_service import is_duplicate_event

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/webhooks/evolution")
async def receive_evolution_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    raw_payload = await request.json()
    event_name = raw_payload.get("event")
    logger.info("Webhook recebido: event=%r instance=%r", event_name, raw_payload.get("instanceName"))

    # "Receipt" (ACK de entrega/leitura) tem formato totalmente diferente
    # de "Message" (MessageSource achatado, sem Info/Message aninhados) —
    # tratado à parte, ANTES de validar contra o schema de Message (que
    # rejeitaria o payload inteiro por falta de Info/Message obrigatórios).
    if event_name == "Receipt":
        return await _handle_receipt_event(db, raw_payload)

    try:
        payload = EvolutionWebhookPayload.model_validate(raw_payload)
    except ValidationError as exc:
        logger.warning(
            "Payload de webhook não reconhecido, ignorado: event=%r erro=%s payload=%s",
            event_name, exc, raw_payload,
        )
        return {"status": "ignored"}

    parsed = parse_inbound_webhook(payload, raw_payload)
    if parsed is None:
        logger.info("Webhook ignorado (evento irrelevante pro fluxo): event=%r", event_name)
        return {"status": "ignored"}

    tenant = await occurrence_service.get_tenant_by_instance(db, parsed.instance_name)
    if tenant is None:
        logger.warning("Webhook de instância desconhecida: %s", parsed.instance_name)
        return {"status": "tenant_not_found"}

    duplicate = await is_duplicate_event(db, tenant.id, parsed.external_message_id, payload.event)
    if duplicate:
        logger.info(
            "Webhook duplicado, ignorado: tenant=%s external_message_id=%s",
            tenant.id, parsed.external_message_id,
        )
        await db.commit()
        return {"status": "duplicate"}

    logger.info(
        "Processando mensagem inbound: tenant=%s phone=%s external_message_id=%s content_type=%s",
        tenant.id, parsed.phone, parsed.external_message_id, parsed.content_type.value,
    )
    await occurrence_service.handle_inbound_message(db, settings, tenant, parsed)
    await db.commit()
    return {"status": "ok"}


async def _handle_receipt_event(db: AsyncSession, raw_payload: dict) -> dict:
    try:
        payload = EvolutionReceiptPayload.model_validate(raw_payload)
    except ValidationError as exc:
        logger.warning("Payload de Receipt não reconhecido, ignorado: erro=%s payload=%s", exc, raw_payload)
        return {"status": "ignored"}

    parsed = parse_receipt_webhook(payload)
    if parsed is None:
        logger.info(
            "Receipt ignorado (não é ACK de mensagem nossa, ou tipo sem mapeamento): raw_type=%r",
            raw_payload.get("data", {}).get("Type"),
        )
        return {"status": "ignored"}

    tenant = await occurrence_service.get_tenant_by_instance(db, parsed.instance_name)
    if tenant is None:
        logger.warning("Receipt de instância desconhecida: %s", parsed.instance_name)
        return {"status": "tenant_not_found"}

    updated = await occurrence_service.update_delivery_status(
        db, tenant.id, parsed.message_ids, parsed.status
    )
    logger.info(
        "Receipt processado: tenant=%s status=%s message_ids=%s linhas_atualizadas=%d",
        tenant.id, parsed.status, parsed.message_ids, updated,
    )
    await db.commit()
    return {"status": "ok"}
