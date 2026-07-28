"""
Driver = cadastro persistente do motorista, por tenant.

Antes deste model, o motorista era só texto solto copiado em cada
Occurrence (driver_phone/driver_name) — sem identidade entre ocorrências.
Este cadastro existe para permitir personalização (nome, veículo) e para
servir de chave de junção com a planilha de rota (RouteManifestEntry),
sem que a Occurrence precise deixar de gravar driver_phone/driver_name
(mantidos por compatibilidade com o motor existente).

tenant_id é nullable: motorista assinante do low ticket pode ser
cadastrado no backoffice antes de saber a qual transportadora ele
pertence — fica "órfão" até alguém vincular depois (ver
app.services.driver_service.create_driver / assign_tenant). Enquanto
órfão, não recebe código de login (o envio depende do WhatsApp Business
da tenant), então nunca aparece como "assinante" de verdade.
"""
import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import DriverPlatform


def _values(enum_cls):
    return [e.value for e in enum_cls]


driver_platform_enum = PGEnum(DriverPlatform, name="driver_platform", create_type=False, values_callable=_values)


class Driver(Base):
    __tablename__ = "drivers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "phone", name="uq_drivers_tenant_id_phone"),
        Index("ix_drivers_tenant_id", "tenant_id"),
        # Índice único parcial (só tenant_id IS NULL) criado direto na
        # migration a3d8f5c1e7b2 — a UniqueConstraint acima não cobre esse
        # caso porque o Postgres trata múltiplos NULLs como não-duplicados.
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=True
    )

    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vehicle_plate: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vehicle_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Só dígitos, sem máscara — exigido pelo Asaas pra criar o customer da
    # assinatura (app.services.driver_subscription_service). Nullable
    # porque cadastro/login não dependem disso, só a adesão paga.
    cpf: Mapped[str | None] = mapped_column(String(11), nullable=True)

    # Plataforma onde o motorista trabalha, usada pra escolher o heurístico
    # de OCR certo em app.services.route_screen_extraction_service. Nullable
    # até o motorista escolher pela primeira vez; DISTRIBUIDORA nunca cria
    # RouteCaptureSession, reaproveita o fluxo de nota fiscal existente.
    platform: Mapped[DriverPlatform | None] = mapped_column(driver_platform_enum, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
