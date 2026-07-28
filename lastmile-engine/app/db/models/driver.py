"""
Driver = cadastro persistente do motorista, por tenant.

Antes deste model, o motorista era só texto solto copiado em cada
Occurrence (driver_phone/driver_name) — sem identidade entre ocorrências.
Este cadastro existe para permitir personalização (nome, veículo) e para
servir de chave de junção com a planilha de rota (RouteManifestEntry),
sem que a Occurrence precise deixar de gravar driver_phone/driver_name
(mantidos por compatibilidade com o motor existente).
"""
import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Driver(Base):
    __tablename__ = "drivers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "phone", name="uq_drivers_tenant_id_phone"),
        Index("ix_drivers_tenant_id", "tenant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False
    )

    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vehicle_plate: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vehicle_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
