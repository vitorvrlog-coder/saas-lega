"""
DriverLoginCode = código de uso único enviado por WhatsApp para autenticar
o motorista no app (app.services.driver_auth_service) — não existe
senha/credencial de Driver, o telefone já verificado via WhatsApp é a prova
de identidade. Guardado hasheado (mesmo padrão de senha, app.core.security)
e de uso único (used_at) para não permitir replay do mesmo código.
"""
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DriverLoginCode(Base):
    __tablename__ = "driver_login_codes"
    __table_args__ = (Index("ix_driver_login_codes_driver_id", "driver_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False
    )

    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
