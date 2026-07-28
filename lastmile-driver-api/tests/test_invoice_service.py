"""Testes básicos de app.services.invoice_service — CRUD de notas fiscais
enviadas pelo motorista (fase 1: só o caminho XML, determinístico)."""
import uuid

import pytest

from app.db.models.driver import Driver
from app.db.models.enums import InvoiceEntryStatus
from app.db.models.tenant import Tenant
from app.services import invoice_service
from app.services.invoice_extraction_service import ExtractedInvoiceData
from app.services.invoice_service import (
    InvoiceReviewError,
    create_invoice_entry_from_xml,
    reject_invoice_entry,
    update_invoice_entry_fields,
)


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-invoice-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Nota Fiscal", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def _make_driver(db_session, tenant: Tenant) -> Driver:
    driver = Driver(tenant_id=tenant.id, phone="5547999998888")
    db_session.add(driver)
    await db_session.flush()
    return driver


def _stub_extract_from_xml(monkeypatch, **overrides):
    defaults = dict(
        order_number="PED-123", customer_name="Maria",
        customer_phone="5547988887777", customer_address="Rua Teste, 123", raw={},
    )
    defaults.update(overrides)
    monkeypatch.setattr(invoice_service, "extract_from_xml", lambda xml_bytes: ExtractedInvoiceData(**defaults))


async def test_create_invoice_entry_from_xml_confirms_immediately(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    _stub_extract_from_xml(monkeypatch)

    entry = await create_invoice_entry_from_xml(db_session, tenant.id, driver.id, b"<xml/>")

    assert entry.status == InvoiceEntryStatus.CONFIRMED
    assert entry.order_number == "PED-123"
    assert entry.confirmed_at is not None


async def test_reject_invoice_entry_requires_pending_review(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    _stub_extract_from_xml(monkeypatch)
    entry = await create_invoice_entry_from_xml(db_session, tenant.id, driver.id, b"<xml/>")

    # XML já chega CONFIRMED — não pode ser rejeitado direto.
    with pytest.raises(InvoiceReviewError):
        await reject_invoice_entry(entry)


async def test_update_invoice_entry_fields_requires_pending_review(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    _stub_extract_from_xml(monkeypatch)
    entry = await create_invoice_entry_from_xml(db_session, tenant.id, driver.id, b"<xml/>")

    with pytest.raises(InvoiceReviewError):
        await update_invoice_entry_fields(entry, customer_name="Novo Nome")
