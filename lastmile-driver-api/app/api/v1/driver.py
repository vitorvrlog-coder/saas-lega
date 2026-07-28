"""Endpoints do app do motorista (upload de nota fiscal) — fase 1: login por
código de WhatsApp + upload de XML de NFe. Ver plano de arquitetura
(feature "contato preventivo via upload de nota fiscal")."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.driver_auth import DriverIdentity, create_driver_token, require_driver_auth
from app.db.models.tenant import Tenant
from app.db.session import get_db
from app.schemas.driver import (
    InvoiceEntryRead,
    InvoiceEntryUpdate,
    RequestCodeRequest,
    TokenResponse,
    VerifyCodeRequest,
)
from app.services import driver_auth_service, invoice_service
from app.services.invoice_extraction_service import InvoiceExtractionError
from app.services.invoice_service import InvoicePreventiveContactError, InvoiceReviewError

router = APIRouter(prefix="/driver")


@router.post("/auth/request-code", status_code=204)
async def request_code(
    data: RequestCodeRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    tenant = await db.get(Tenant, data.tenant_id)
    driver = await driver_auth_service.get_active_driver(db, data.tenant_id, data.phone) if tenant else None

    # Resposta idêntica exista ou não o motorista/tenant — não confirma
    # nem nega cadastro de telefone a quem não está autenticado.
    if tenant is not None and driver is not None:
        code = await driver_auth_service.issue_login_code(db, driver)
        await driver_auth_service.send_login_code(db, settings, tenant, driver, code)
        await db.commit()


@router.post("/auth/verify-code", response_model=TokenResponse)
async def verify_code(
    data: VerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    driver = await driver_auth_service.get_active_driver(db, data.tenant_id, data.phone)
    if driver is None or not await driver_auth_service.verify_login_code(db, driver, data.code):
        raise HTTPException(status_code=401, detail="Código inválido ou expirado.")

    await db.commit()
    token = create_driver_token(settings, driver.id, data.tenant_id)
    return TokenResponse(access_token=token)


@router.post("/invoices/xml", response_model=InvoiceEntryRead)
async def upload_invoice_xml(
    file: UploadFile,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> InvoiceEntryRead:
    xml_bytes = await file.read()
    try:
        entry = await invoice_service.create_invoice_entry_from_xml(
            db, identity.tenant_id, identity.driver_id, xml_bytes
        )
    except InvoiceExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/invoices/photo", response_model=InvoiceEntryRead)
async def upload_invoice_photo(
    file: UploadFile,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> InvoiceEntryRead:
    image_bytes = await file.read()
    try:
        entry = await invoice_service.create_invoice_entry_from_photo(
            db, settings, identity.tenant_id, identity.driver_id, image_bytes
        )
    except InvoiceExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(entry)
    return entry


@router.get("/invoices", response_model=list[InvoiceEntryRead])
async def list_invoices(
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> list[InvoiceEntryRead]:
    return await invoice_service.list_invoice_entries(db, identity.tenant_id, identity.driver_id)


@router.get("/invoices/{entry_id}", response_model=InvoiceEntryRead)
async def get_invoice(
    entry_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> InvoiceEntryRead:
    entry = await invoice_service.get_invoice_entry(db, identity.tenant_id, identity.driver_id, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada.")
    return entry


@router.patch("/invoices/{entry_id}", response_model=InvoiceEntryRead)
async def update_invoice(
    entry_id: uuid.UUID,
    data: InvoiceEntryUpdate,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> InvoiceEntryRead:
    entry = await invoice_service.get_invoice_entry(db, identity.tenant_id, identity.driver_id, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada.")

    try:
        await invoice_service.update_invoice_entry_fields(
            entry,
            customer_name=data.customer_name,
            customer_phone=data.customer_phone,
            customer_address=data.customer_address,
            order_number=data.order_number,
        )
    except InvoiceReviewError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/invoices/{entry_id}/reject", response_model=InvoiceEntryRead)
async def reject_invoice(
    entry_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
) -> InvoiceEntryRead:
    entry = await invoice_service.get_invoice_entry(db, identity.tenant_id, identity.driver_id, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada.")

    try:
        await invoice_service.reject_invoice_entry(entry)
    except InvoiceReviewError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/invoices/{entry_id}/confirm", response_model=InvoiceEntryRead)
async def confirm_invoice(
    entry_id: uuid.UUID,
    identity: DriverIdentity = Depends(require_driver_auth),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> InvoiceEntryRead:
    entry = await invoice_service.get_invoice_entry(db, identity.tenant_id, identity.driver_id, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada.")

    tenant = await db.get(Tenant, identity.tenant_id)
    try:
        await invoice_service.confirm_and_send_preventive_contact(db, settings, tenant, entry)
    except InvoicePreventiveContactError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(entry)
    return entry
