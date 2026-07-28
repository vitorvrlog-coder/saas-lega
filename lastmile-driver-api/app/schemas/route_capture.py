"""Schemas de request/response da API de captura de rota (app.api.v1.route_capture)."""
import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import (
    DriverPlatform,
    RouteCapturePrescreenStatus,
    RouteCaptureSessionStatus,
    RouteCaptureStopOcrStatus,
)


class RouteCaptureSessionCreate(BaseModel):
    platform: DriverPlatform


class RouteCaptureStopUpdate(BaseModel):
    customer_name: str | None = Field(default=None, min_length=1, max_length=255)
    customer_phone: str | None = Field(default=None, min_length=8, max_length=32)
    customer_address: str | None = Field(default=None, min_length=1)


class RouteCaptureStopRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ocr_status: RouteCaptureStopOcrStatus
    customer_name: str | None
    customer_phone: str | None
    customer_address: str | None
    ocr_confidence: float | None
    prescreen_status: RouteCapturePrescreenStatus
    route_sequence: int | None
    created_at: datetime.datetime


class RouteCaptureSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    platform: DriverPlatform
    status: RouteCaptureSessionStatus
    created_at: datetime.datetime
    confirmed_at: datetime.datetime | None
    route_ready_at: datetime.datetime | None
