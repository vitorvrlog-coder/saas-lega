"""
Pré-triagem via WhatsApp das paradas confirmadas de uma RouteCaptureSession
— manda uma mensagem pro cliente perguntando disponibilidade/endereço antes
da tentativa de entrega, classifica a resposta, e notifica o motorista a
cada resposta recebida (requisito confirmado em conversa: o motorista quer
saber "Parada Nº X respondeu: '...'" pelo WhatsApp, não só ver o status
mudar dentro do app).

Espelha app.services.invoice_service.confirm_and_send_preventive_contact:
sempre checa o retorno None de send_text_message (nunca marca como
enviado sem confirmação real de envio) e usa import local de
occurrence_service pra evitar ciclo (occurrence_service importa
find_stop_awaiting_prescreen_reply e classify_prescreen_reply deste
módulo, via handle_inbound_message).
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import run_structured
from app.ai.factory import get_ai_provider
from app.ai.prompts import route_prescreen_reply
from app.core.config import Settings
from app.db.models.enums import (
    AIDecisionType,
    MessageContentType,
    MessageDirection,
    MessageParticipant,
    RouteCapturePrescreenStatus,
)
from app.db.models.route_capture_session import RouteCaptureSession
from app.db.models.route_capture_stop import RouteCaptureStop
from app.integrations.evolution_api.webhook_parser import ParsedInboundMessage
from app.schemas.ai_outputs import RoutePrescreenCategory, RoutePrescreenReplyOutput
from app.services.message_templates import (
    ROUTE_CAPTURE_DRIVER_NOTIFY_REPLY,
    ROUTE_CAPTURE_DRIVER_NOTIFY_ROUTE,
    ROUTE_CAPTURE_PRESCREEN_CUSTOMER,
    render_template,
)

__all__ = [
    "RouteCapturePrescreenError",
    "send_prescreen_for_stop",
    "send_prescreen_for_session",
    "find_stop_awaiting_prescreen_reply",
    "classify_prescreen_reply",
    "notify_driver_of_route",
]


class RouteCapturePrescreenError(Exception):
    pass


_STATUS_LABEL = {
    RoutePrescreenCategory.CONFIRMED: "confirmado",
    RoutePrescreenCategory.UNAVAILABLE: "indisponível",
    RoutePrescreenCategory.ADDRESS_WRONG: "endereço errado",
    RoutePrescreenCategory.AMBIGUOUS: "ambíguo — verificar manualmente",
}

_PRESCREEN_STATUS_BY_CATEGORY = {
    RoutePrescreenCategory.CONFIRMED: RouteCapturePrescreenStatus.CONFIRMED,
    RoutePrescreenCategory.UNAVAILABLE: RouteCapturePrescreenStatus.UNAVAILABLE,
    RoutePrescreenCategory.ADDRESS_WRONG: RouteCapturePrescreenStatus.ADDRESS_WRONG,
    # Ambíguo fica marcado como SENT mesmo (não muda status) — não é um
    # desfecho final, fica pra revisão manual do motorista/operador; v1
    # não tem reprompt automático (ver plano).
}


async def _stop_label(db: AsyncSession, stop: RouteCaptureStop) -> str:
    result = await db.execute(
        select(RouteCaptureStop.id)
        .where(RouteCaptureStop.session_id == stop.session_id)
        .order_by(RouteCaptureStop.created_at.asc())
    )
    ids = [row[0] for row in result.all()]
    index = ids.index(stop.id) + 1 if stop.id in ids else "?"
    return f"Parada Nº {index}"


async def send_prescreen_for_stop(
    db: AsyncSession, settings: Settings, tenant, stop: RouteCaptureStop
) -> None:
    """Levanta RouteCapturePrescreenError pra qualquer motivo que impeça o
    envio — fica a critério do chamador decidir se aborta a sessão inteira
    ou só loga e segue (send_prescreen_for_session escolhe seguir)."""
    if not stop.customer_phone or not stop.customer_address:
        raise RouteCapturePrescreenError("Parada sem telefone ou endereço do cliente.")

    # Import local pra evitar ciclo: occurrence_service importa deste
    # módulo (find_stop_awaiting_prescreen_reply/classify_prescreen_reply).
    from app.services.occurrence_service import evolution_client_for, log_message, send_text_message

    text = render_template(
        tenant, ROUTE_CAPTURE_PRESCREEN_CUSTOMER,
        customer_name=stop.customer_name or "", address=stop.customer_address,
    )
    if text is None:
        raise RouteCapturePrescreenError("Tenant sem template 'route_capture_prescreen_customer' configurado.")

    from app.integrations.evolution_api.client import EvolutionAPIError

    client = evolution_client_for(tenant, settings)
    try:
        result = await send_text_message(
            db, client, tenant, ROUTE_CAPTURE_PRESCREEN_CUSTOMER, stop.customer_phone, text,
            customer_name=stop.customer_name or "", address=stop.customer_address,
        )
    except EvolutionAPIError as exc:
        # Erro real de envio (token expirado, rede) não pode virar 500 cru
        # nem propagar sem controle — vira erro de domínio igual a
        # qualquer outro motivo de falha aqui (mesmo bug encontrado em
        # invoice_service/driver_auth_service 2026-07-12).
        raise RouteCapturePrescreenError(f"Falha ao enviar mensagem: {exc}") from exc
    # Mesma checagem do bug já corrigido em invoice_service: sem isso o
    # status vira SENT mesmo quando nada foi enviado de verdade (sem janela
    # de 24h aberta nem template aprovado na Meta pra essa chave).
    if result is None:
        raise RouteCapturePrescreenError(
            "Não foi possível enviar: sem sessão de 24h aberta com o cliente "
            "nem template aprovado na Meta para 'route_capture_prescreen_customer'."
        )

    external_message_id = None
    if isinstance(result, dict):
        messages = result.get("messages") or []
        if messages:
            external_message_id = messages[0].get("id")

    log_message(
        db, tenant.id, None, MessageDirection.OUTBOUND, MessageParticipant.CUSTOMER,
        stop.customer_phone, MessageContentType.TEXT, text,
        external_message_id=external_message_id, raw_payload=result if isinstance(result, dict) else {},
    )

    import datetime

    stop.prescreen_status = RouteCapturePrescreenStatus.SENT
    stop.prescreen_sent_at = datetime.datetime.now(datetime.timezone.utc)


async def send_prescreen_for_session(
    db: AsyncSession, settings: Settings, tenant, stops: list[RouteCaptureStop]
) -> None:
    """Uma falha de envio numa parada não deve travar as outras — loga e
    segue, deixando aquela parada em NOT_SENT pra reenvio manual depois."""
    import logging

    logger = logging.getLogger(__name__)

    for stop in stops:
        try:
            await send_prescreen_for_stop(db, settings, tenant, stop)
        except RouteCapturePrescreenError as exc:
            logger.warning("Falha ao enviar pré-triagem da parada %s: %s", stop.id, exc)


async def find_stop_awaiting_prescreen_reply(
    db: AsyncSession, tenant_id: uuid.UUID, customer_phone: str
) -> RouteCaptureStop | None:
    result = await db.execute(
        select(RouteCaptureStop)
        .where(
            RouteCaptureStop.tenant_id == tenant_id,
            RouteCaptureStop.customer_phone == customer_phone,
            RouteCaptureStop.prescreen_status == RouteCapturePrescreenStatus.SENT,
        )
        .order_by(RouteCaptureStop.prescreen_sent_at.desc())
    )
    return result.scalars().first()


async def classify_prescreen_reply(
    db: AsyncSession, settings: Settings, tenant, stop: RouteCaptureStop, message: ParsedInboundMessage
) -> RouteCaptureStop:
    """Classifica a resposta do cliente, atualiza o status da parada, e
    notifica o motorista via WhatsApp citando a troca real (pergunta +
    resposta do cliente) — requisito confirmado em conversa. Sem "print":
    não existe tela de WhatsApp do lado do backend pra capturar, é tudo
    API — o comprovante é o texto completo citado na mensagem."""
    import datetime

    if not message.content_text:
        # Sem texto classificável (ex: áudio) — fica SENT mesmo,
        # aguardando resposta de verdade ou timeout (ver worker da Fase 3).
        return stop

    provider = get_ai_provider(settings)
    result = await run_structured(
        provider,
        route_prescreen_reply.SYSTEM_PROMPT,
        route_prescreen_reply.build_user_prompt(message.content_text),
        RoutePrescreenReplyOutput,
    )

    from app.services.occurrence_service import log_ai_decision

    category = result.output.category if result.output else RoutePrescreenCategory.AMBIGUOUS
    log_ai_decision(
        db, tenant.id, None, AIDecisionType.REPLY_CLASSIFICATION,
        ai_provider=result.provider, ai_model=result.model,
        input_payload={"customer_message": message.content_text},
        output_payload=result.raw_output, is_valid_schema=result.is_valid_schema,
        confidence=result.output.confidence if result.output else None,
        is_ambiguous=result.output.is_ambiguous if result.output else True,
        escalated_to_human=(category == RoutePrescreenCategory.AMBIGUOUS),
        error_message=result.error_message,
    )

    stop.prescreen_responded_at = datetime.datetime.now(datetime.timezone.utc)
    new_status = _PRESCREEN_STATUS_BY_CATEGORY.get(category)
    if new_status is not None:
        stop.prescreen_status = new_status
    if category == RoutePrescreenCategory.ADDRESS_WRONG and result.output and result.output.new_address_text:
        stop.customer_address = result.output.new_address_text

    await _notify_driver_of_reply(db, settings, tenant, stop, message.content_text, category)

    return stop


async def _notify_driver_of_reply(
    db: AsyncSession, settings: Settings, tenant, stop: RouteCaptureStop, customer_reply_text: str,
    category: RoutePrescreenCategory,
) -> None:
    """Best-effort — chamado a partir do webhook, que precisa sempre
    responder 200 (senão o gateway reenvia o mesmo evento indefinidamente).
    Falha de notificação ao motorista não deve impedir a classificação da
    resposta do cliente de ser salva."""
    import logging

    logger = logging.getLogger(__name__)

    session = await db.get(RouteCaptureSession, stop.session_id)
    if session is None:
        return

    from app.db.models.driver import Driver

    driver = await db.get(Driver, session.driver_id)
    if driver is None:
        return

    stop_label = await _stop_label(db, stop)
    text = render_template(
        tenant, ROUTE_CAPTURE_DRIVER_NOTIFY_REPLY,
        stop_label=stop_label, customer_reply_text=customer_reply_text,
        status_label=_STATUS_LABEL[category],
    )
    if text is None:
        return

    from app.integrations.evolution_api.client import EvolutionAPIError, extract_message_id
    from app.services.occurrence_service import evolution_client_for, log_message, send_text_message

    try:
        client = evolution_client_for(tenant, settings)
        result = await send_text_message(
            db, client, tenant, ROUTE_CAPTURE_DRIVER_NOTIFY_REPLY, driver.phone, text,
            stop_label=stop_label, customer_reply_text=customer_reply_text,
            status_label=_STATUS_LABEL[category],
        )
        if result is None:
            return
        log_message(
            db, tenant.id, None, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
            driver.phone, MessageContentType.TEXT, text,
            external_message_id=extract_message_id(result),
            raw_payload=result if isinstance(result, dict) else {"raw_text_response": result},
        )
    except EvolutionAPIError as exc:
        logger.warning("Falha ao notificar motorista da resposta da parada %s: %s", stop.id, exc)


async def notify_driver_of_route(
    db: AsyncSession, settings: Settings, tenant, driver, session: RouteCaptureSession,
    ordered_stops: list[RouteCaptureStop],
) -> None:
    """Manda a rota otimizada pro WhatsApp do motorista, ALÉM de aparecer
    no app — requisito confirmado em conversa. Best-effort: chamado a
    partir de uma ação explícita do motorista (botão "Otimizar rota"), não
    do webhook, mas mantém a mesma disciplina de nunca derrubar o fluxo
    principal por falha de notificação."""
    import logging

    logger = logging.getLogger(__name__)

    ordered = sorted(ordered_stops, key=lambda s: s.route_sequence or 0)
    lines = [
        f"{i}. {stop.customer_name or 'Cliente'} — {stop.customer_address}"
        for i, stop in enumerate(ordered, start=1)
    ]
    route_summary_text = "\n".join(lines)

    text = render_template(tenant, ROUTE_CAPTURE_DRIVER_NOTIFY_ROUTE, route_summary_text=route_summary_text)
    if text is None:
        return

    from app.integrations.evolution_api.client import EvolutionAPIError, extract_message_id
    from app.services.occurrence_service import evolution_client_for, log_message, send_text_message

    try:
        client = evolution_client_for(tenant, settings)
        result = await send_text_message(
            db, client, tenant, ROUTE_CAPTURE_DRIVER_NOTIFY_ROUTE, driver.phone, text,
            route_summary_text=route_summary_text,
        )
        if result is None:
            return
        log_message(
            db, tenant.id, None, MessageDirection.OUTBOUND, MessageParticipant.DRIVER,
            driver.phone, MessageContentType.TEXT, text,
            external_message_id=extract_message_id(result),
            raw_payload=result if isinstance(result, dict) else {"raw_text_response": result},
        )
    except EvolutionAPIError as exc:
        logger.warning("Falha ao notificar motorista da rota otimizada (sessão %s): %s", session.id, exc)
