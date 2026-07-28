"""
RouteCaptureStop = uma parada extraída de uma ou mais capturas de tela de
uma RouteCaptureSession, via OCR (app.services.route_screen_extraction_service).

Mercado Livre exige duas capturas por parada (tela de detalhe com nome e
endereço, e a tela que aparece após o motorista tocar em "Ligar", que revela
o telefone como texto) — por isso os dois screenshot_storage_key. Shopee
resolve tudo numa captura só (telefone já aparece como texto na tela de
detalhe), então screenshot_storage_key_phone fica sempre nulo pra essa
plataforma.

Os heurísticos de extração ainda são provisórios (ver
app.services.route_screen_extraction_service) até a Fase 0 de validação de
amostras reais rodar — esta tabela já existe para não bloquear o resto do
fluxo enquanto isso é calibrado.
"""
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import RouteCapturePrescreenStatus, RouteCaptureStopOcrStatus


def _values(enum_cls):
    return [e.value for e in enum_cls]


route_capture_stop_ocr_status_enum = PGEnum(
    RouteCaptureStopOcrStatus, name="route_capture_stop_ocr_status", create_type=False, values_callable=_values
)
route_capture_prescreen_status_enum = PGEnum(
    RouteCapturePrescreenStatus, name="route_capture_prescreen_status", create_type=False, values_callable=_values
)


class RouteCaptureStop(Base):
    __tablename__ = "route_capture_stops"
    __table_args__ = (
        Index("ix_route_capture_stops_session_id", "session_id"),
        Index("ix_route_capture_stops_tenant_id_prescreen_status", "tenant_id", "prescreen_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    # CASCADE (diferente de InvoiceEntry.route_manifest_entry_id, que usa
    # SET NULL): uma parada não tem vida própria fora da sessão que a
    # gerou, então apagar a sessão apaga suas paradas.
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("route_capture_sessions.id", ondelete="CASCADE"), nullable=False
    )

    screenshot_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    screenshot_storage_key_phone: Mapped[str | None] = mapped_column(String(512), nullable=True)

    ocr_status: Mapped[RouteCaptureStopOcrStatus] = mapped_column(
        route_capture_stop_ocr_status_enum,
        nullable=False,
        server_default=RouteCaptureStopOcrStatus.PENDING_REVIEW.value,
    )

    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    customer_address: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_extracted_json: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    ocr_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)

    prescreen_status: Mapped[RouteCapturePrescreenStatus] = mapped_column(
        route_capture_prescreen_status_enum,
        nullable=False,
        server_default=RouteCapturePrescreenStatus.NOT_SENT.value,
    )
    prescreen_sent_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prescreen_responded_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Preenchidos por app.services.route_optimizer_service.
    lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    lon: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    route_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
