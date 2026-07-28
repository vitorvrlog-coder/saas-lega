"""Schemas de request/response da API do app do motorista (app.api.v1.driver)."""
import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import InvoiceEntrySource, InvoiceEntryStatus


class RequestCodeRequest(BaseModel):
    tenant_id: uuid.UUID
    phone: str = Field(min_length=8, max_length=32)


class VerifyCodeRequest(BaseModel):
    tenant_id: uuid.UUID
    phone: str = Field(min_length=8, max_length=32)
    code: str = Field(min_length=6, max_length=6)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class InvoiceEntryUpdate(BaseModel):
    customer_name: str | None = Field(default=None, min_length=1, max_length=255)
    customer_phone: str | None = Field(default=None, min_length=8, max_length=32)
    customer_address: str | None = Field(default=None, min_length=1)
    order_number: str | None = Field(default=None, min_length=1, max_length=100)


class InvoiceEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: InvoiceEntrySource
    status: InvoiceEntryStatus
    order_number: str | None
    customer_name: str | None
    customer_phone: str | None
    customer_address: str | None
    ocr_confidence: float | None
    created_at: datetime.datetime
    confirmed_at: datetime.datetime | None
