"""
RouteCaptureSession = agrupador de uma "leva" de capturas de tela que o
motorista faz dentro do app oficial da plataforma onde trabalha (Mercado
Livre "Entregas", Shopee), via MediaProjection do Android — nunca hooking,
nunca leitura em segundo plano; cada captura é uma ação explícita do
motorista com o indicador de gravação do próprio Android sempre visível.

DISTRIBUIDORA nunca cria uma RouteCaptureSession: ao escolher essa opção na
tela de seleção de plataforma, o app navega direto pro fluxo de nota fiscal
já existente (ver app.db.models.invoice_entry), sem tocar nesta tabela.
"""
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.driver import driver_platform_enum
from app.db.models.enums import RouteCaptureSessionStatus


def _values(enum_cls):
    return [e.value for e in enum_cls]


route_capture_session_status_enum = PGEnum(
    RouteCaptureSessionStatus, name="route_capture_session_status", create_type=False, values_callable=_values
)


class RouteCaptureSession(Base):
    __tablename__ = "route_capture_sessions"
    __table_args__ = (
        Index("ix_route_capture_sessions_tenant_id_driver_id_status", "tenant_id", "driver_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False
    )

    # Snapshot da plataforma no início da sessão — independente de
    # Driver.platform mudar depois, a sessão sempre sabe qual heurístico
    # de OCR foi usado para as capturas que ela contém.
    platform: Mapped[str] = mapped_column(driver_platform_enum, nullable=False)
    status: Mapped[RouteCaptureSessionStatus] = mapped_column(
        route_capture_session_status_enum,
        nullable=False,
        server_default=RouteCaptureSessionStatus.IN_PROGRESS.value,
    )

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    confirmed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    route_ready_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
