"""Testes básicos de app.services.route_capture_service — sessão de
captura guiada de telas do app de entrega (ML/Shopee)."""
import uuid

import pytest

from app.core.config import get_settings
from app.db.models.driver import Driver
from app.db.models.enums import DriverPlatform, RouteCaptureStopOcrStatus
from app.db.models.tenant import Tenant
from app.services import route_capture_service
from app.services.route_capture_service import (
    RouteCaptureReviewError,
    RouteCaptureSessionError,
    confirm_stop,
    create_session,
    reject_stop,
    upload_screenshot,
)
from app.services.route_screen_extraction_service import ExtractedStopData


async def _make_tenant(db_session) -> Tenant:
    slug = f"tenant-routecapture-{uuid.uuid4().hex[:8]}"
    tenant = Tenant(
        name="Tenant Captura de Rota", slug=slug,
        evolution_instance=slug, evolution_token="tok",
        message_templates={},
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


async def _make_driver(db_session, tenant: Tenant) -> Driver:
    driver = Driver(tenant_id=tenant.id, phone="5547999998888", platform=DriverPlatform.SHOPEE)
    db_session.add(driver)
    await db_session.flush()
    return driver


def _stub_extract_stops(monkeypatch, *, phone: str | None, address: str | None):
    monkeypatch.setattr(
        route_capture_service, "extract_stops",
        lambda platform, image_bytes, settings, screenshot_role="stop": [
            ExtractedStopData(
                customer_name="Maria", customer_phone=phone, customer_address=address, raw={},
            )
        ],
    )


async def test_create_session_rejects_distribuidora_platform(db_session):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)

    with pytest.raises(RouteCaptureSessionError):
        await create_session(db_session, tenant.id, driver.id, DriverPlatform.DISTRIBUIDORA)


async def test_upload_screenshot_creates_stops_from_extraction(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    session = await create_session(db_session, tenant.id, driver.id, DriverPlatform.SHOPEE)
    _stub_extract_stops(monkeypatch, phone="5547988887777", address="Rua Teste, 123")

    stops = await upload_screenshot(db_session, get_settings(), session, b"fake-image-bytes")

    assert len(stops) == 1
    assert stops[0].customer_name == "Maria"
    assert stops[0].ocr_status == RouteCaptureStopOcrStatus.PENDING_REVIEW


async def test_confirm_stop_requires_phone_and_address(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    session = await create_session(db_session, tenant.id, driver.id, DriverPlatform.SHOPEE)
    _stub_extract_stops(monkeypatch, phone=None, address=None)
    [stop] = await upload_screenshot(db_session, get_settings(), session, b"fake-image-bytes")

    with pytest.raises(RouteCaptureReviewError):
        await confirm_stop(stop)


async def test_confirm_stop_succeeds_with_phone_and_address(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    session = await create_session(db_session, tenant.id, driver.id, DriverPlatform.SHOPEE)
    _stub_extract_stops(monkeypatch, phone="5547988887777", address="Rua Teste, 123")
    [stop] = await upload_screenshot(db_session, get_settings(), session, b"fake-image-bytes")

    confirmed = await confirm_stop(stop)

    assert confirmed.ocr_status == RouteCaptureStopOcrStatus.CONFIRMED


async def test_reject_stop_marks_rejected(db_session, monkeypatch):
    tenant = await _make_tenant(db_session)
    driver = await _make_driver(db_session, tenant)
    session = await create_session(db_session, tenant.id, driver.id, DriverPlatform.SHOPEE)
    _stub_extract_stops(monkeypatch, phone=None, address=None)
    [stop] = await upload_screenshot(db_session, get_settings(), session, b"fake-image-bytes")

    rejected = await reject_stop(stop)

    assert rejected.ocr_status == RouteCaptureStopOcrStatus.REJECTED
