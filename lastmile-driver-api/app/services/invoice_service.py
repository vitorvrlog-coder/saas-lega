"""
CRUD de app.db.models.invoice_entry.InvoiceEntry — fase 1 do plano de
arquitetura: só o caminho de XML (determinístico, sem revisão humana). O
caminho de foto/OCR (PENDING_REVIEW, confirm/reject) é fase 3, ainda não
implementado aqui.
"""
import datetime
import urllib.parse
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models.driver import Driver
from app.db.models.enums import (
    InvoiceEntrySource,
    InvoiceEntryStatus,
    MessageContentType,
    MessageDirection,
    MessageParticipant,
)
from app.db.models.invoice_entry import InvoiceEntry
from app.db.models.tenant import Tenant
from app.integrations.evolution_api.phone import normalize_br_phone
from app.services.invoice_extraction_service import (
    InvoiceExtractionError,
    extract_from_photo,
    extract_from_xml,
)
from app.services.message_templates import PREVENTIVE_ORDER_CONFIRMATION, render_template

__all__ = [
    "InvoiceExtractionError",
    "InvoicePreventiveContactError",
    "InvoiceReviewError",
    "create_invoice_entry_from_xml",
    "create_invoice_entry_from_photo",
    "list_invoice_entries",
    "get_invoice_entry",
    "update_invoice_entry_fields",
    "reject_invoice_entry",
    "find_confirmed_invoice_by_order_number",
    "confirm_and_send_preventive_contact",
]


class InvoicePreventiveContactError(Exception):
    pass


class InvoiceReviewError(Exception):
    pass


def build_map_link(address: str) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(address)}"


async def create_invoice_entry_from_xml(
    db: AsyncSession, tenant_id: uuid.UUID, driver_id: uuid.UUID, xml_bytes: bytes
) -> InvoiceEntry:
    extracted = extract_from_xml(xml_bytes)

    entry = InvoiceEntry(
        tenant_id=tenant_id,
        driver_id=driver_id,
        source=InvoiceEntrySource.XML,
        status=InvoiceEntryStatus.CONFIRMED,
        order_number=extracted.order_number,
        customer_name=extracted.customer_name,
        customer_phone=extracted.customer_phone,
        customer_address=extracted.customer_address,
        raw_extracted_json=extracted.raw,
        confirmed_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(entry)
    await db.flush()
    return entry


async def create_invoice_entry_from_photo(
    db: AsyncSession, settings: Settings, tenant_id: uuid.UUID, driver_id: uuid.UUID, image_bytes: bytes
) -> InvoiceEntry:
    extracted = extract_from_photo(image_bytes, settings)

    entry = InvoiceEntry(
        tenant_id=tenant_id,
        driver_id=driver_id,
        source=InvoiceEntrySource.PHOTO_OCR,
        status=InvoiceEntryStatus.PENDING_REVIEW,
        order_number=extracted.order_number,
        customer_name=extracted.customer_name,
        customer_phone=extracted.customer_phone,  # sempre None, ver docstring de extract_from_photo
        customer_address=extracted.customer_address,
        raw_extracted_json=extracted.raw,
        ocr_confidence=extracted.confidence,
    )
    db.add(entry)
    await db.flush()
    return entry


async def update_invoice_entry_fields(
    entry: InvoiceEntry,
    customer_name: str | None = None,
    customer_phone: str | None = None,
    customer_address: str | None = None,
    order_number: str | None = None,
) -> InvoiceEntry:
    """Revisão do motorista sobre uma leitura de OCR (só faz sentido pra
    PENDING_REVIEW — XML já chega CONFIRMED e não deveria precisar de
    correção, mas a validação de estado fica a critério da rota, igual ao
    resto deste módulo)."""
    if entry.status != InvoiceEntryStatus.PENDING_REVIEW:
        raise InvoiceReviewError(f"Nota no estado '{entry.status.value}' não pode ser editada.")

    if customer_name is not None:
        entry.customer_name = customer_name
    if customer_phone is not None:
        entry.customer_phone = customer_phone
    if customer_address is not None:
        entry.customer_address = customer_address
    if order_number is not None:
        entry.order_number = order_number

    return entry


async def reject_invoice_entry(entry: InvoiceEntry) -> InvoiceEntry:
    if entry.status != InvoiceEntryStatus.PENDING_REVIEW:
        raise InvoiceReviewError(f"Nota no estado '{entry.status.value}' não pode ser rejeitada.")
    entry.status = InvoiceEntryStatus.REJECTED
    return entry


async def list_invoice_entries(
    db: AsyncSession, tenant_id: uuid.UUID, driver_id: uuid.UUID
) -> list[InvoiceEntry]:
    result = await db.execute(
        select(InvoiceEntry)
        .where(InvoiceEntry.tenant_id == tenant_id, InvoiceEntry.driver_id == driver_id)
        .order_by(InvoiceEntry.created_at.desc())
    )
    return list(result.scalars().all())


async def get_invoice_entry(
    db: AsyncSession, tenant_id: uuid.UUID, driver_id: uuid.UUID, entry_id: uuid.UUID
) -> InvoiceEntry | None:
    result = await db.execute(
        select(InvoiceEntry).where(
            InvoiceEntry.id == entry_id,
            InvoiceEntry.tenant_id == tenant_id,
            InvoiceEntry.driver_id == driver_id,
        )
    )
    return result.scalars().first()


async def confirm_and_send_preventive_contact(
    db: AsyncSession, settings: Settings, tenant: Tenant, entry: InvoiceEntry
) -> None:
    """Ação explícita do motorista no app: dispara o contato preventivo com
    o cliente. Aceita tanto CONFIRMED (XML, já validado na extração) quanto
    PENDING_REVIEW (foto/OCR — motorista já deve ter revisado/corrigido os
    campos via update_invoice_entry_fields, inclusive preenchendo o
    telefone manualmente, já que extract_from_photo nunca o extrai). Mesmo
    botão de confirmar serve pros dois caminhos: a diferença de origem já
    não importa mais neste ponto, só se os dados estão completos. Levanta
    InvoicePreventiveContactError pra qualquer motivo que impeça o envio —
    fica a critério da rota decidir o código HTTP."""
    if not tenant.preventive_contact_enabled:
        raise InvoicePreventiveContactError("Contato preventivo não está habilitado para este tenant.")
    if entry.status not in (InvoiceEntryStatus.CONFIRMED, InvoiceEntryStatus.PENDING_REVIEW):
        raise InvoicePreventiveContactError(f"Nota no estado '{entry.status.value}' não pode ser confirmada.")
    if not entry.customer_phone or not entry.customer_address:
        raise InvoicePreventiveContactError("Nota sem telefone ou endereço do cliente.")

    # Import local pra evitar ciclo: occurrence_service importa
    # find_confirmed_invoice_by_order_number deste módulo.
    from app.services.occurrence_service import evolution_client_for, log_message, send_text_message

    text = render_template(
        tenant, PREVENTIVE_ORDER_CONFIRMATION,
        customer_name=entry.customer_name or "",
        order_number=entry.order_number or "",
        address=entry.customer_address,
        map_link=build_map_link(entry.customer_address),
    )
    if text is None:
        raise InvoicePreventiveContactError("Tenant sem template 'preventive_order_confirmation' configurado.")

    from app.integrations.evolution_api.client import EvolutionAPIError, extract_message_id

    client = evolution_client_for(tenant, settings)
    try:
        result = await send_text_message(
            db, client, tenant, PREVENTIVE_ORDER_CONFIRMATION, entry.customer_phone, text,
        )
    except EvolutionAPIError as exc:
        # Erro real de envio (token expirado, rede) não pode virar 500 cru
        # pro app — vira erro de domínio como qualquer outro motivo de
        # falha aqui (bug real encontrado 2026-07-12 testando o app: um
        # token expirado derrubava a rota de confirmação inteira).
        raise InvoicePreventiveContactError(f"Falha ao enviar mensagem: {exc}") from exc

    log_message(
        db, tenant.id, None, MessageDirection.OUTBOUND, MessageParticipant.CUSTOMER,
        entry.customer_phone, MessageContentType.TEXT, text,
        external_message_id=extract_message_id(result), raw_payload=result if isinstance(result, dict) else {},
    )

    entry.status = InvoiceEntryStatus.CONTACT_SENT


async def find_confirmed_invoice_by_order_number(
    db: AsyncSession, tenant_id: uuid.UUID, driver_phone: str, order_number: str
) -> InvoiceEntry | None:
    """Contraparte de app.services.manifest_service.find_manifest_entry pra
    motoristas sem planilha de rota (produto de nota fiscal via app) —
    motorista referencia a entrega pelo número da NF, não número de parada.
    Só considera notas CONFIRMED ou CONTACT_SENT (nunca PENDING_REVIEW: uma
    leitura de OCR ainda não confirmada pelo motorista não pode disparar
    contato com o cliente; nunca REJECTED). CONTACT_SENT entra porque o
    motorista pode reportar insucesso mesmo depois do contato preventivo já
    ter sido disparado — a entrega ainda existe, só já passou pela
    confirmação prévia. driver_phone vem como texto solto da mensagem
    inbound (mesma origem de find_manifest_entry), por isso o join por
    telefone normalizado em vez de assumir que o chamador já tem o
    driver_id."""
    normalized_phone = normalize_br_phone(driver_phone)
    result = await db.execute(
        select(InvoiceEntry)
        .join(Driver, Driver.id == InvoiceEntry.driver_id)
        .where(
            InvoiceEntry.tenant_id == tenant_id,
            Driver.phone == normalized_phone,
            InvoiceEntry.order_number == order_number,
            InvoiceEntry.status.in_([InvoiceEntryStatus.CONFIRMED, InvoiceEntryStatus.CONTACT_SENT]),
        )
        .order_by(InvoiceEntry.created_at.desc())
    )
    return result.scalars().first()
