"""
Tenant = operação/cliente do SaaS (transportadora ou embarcador).

Concentra tudo que o requisito de multi-tenant exige que NÃO seja hardcoded:
raio permitido, timeouts de tentativa 1/2 e templates de mensagem. Também
guarda a referência à instância do gateway de WhatsApp (evolution-go) já
em produção — reaproveitando o mesmo padrão que o repositório legado usa
(Company.evolution_instance / evolution_token), para não reinventar a
integração com o gateway.
"""
import datetime
import uuid

from sqlalchemy import Boolean, DateTime, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    # Gateway WhatsApp (evolution-go) — uma instância por tenant, mesmo
    # servidor evolution-go compartilhado entre os produtos.
    evolution_instance: Mapped[str] = mapped_column(String(255), nullable=False)
    evolution_token: Mapped[str] = mapped_column(String(255), nullable=False)

    # Regras de negócio configuráveis por tenant — nunca hardcoded no motor.
    allowed_radius_km: Mapped[float] = mapped_column(
        Numeric(6, 2), nullable=False, server_default="2.00"
    )
    timeout_attempt_1_minutes: Mapped[int] = mapped_column(nullable=False, server_default="30")
    timeout_attempt_2_minutes: Mapped[int] = mapped_column(nullable=False, server_default="60")

    # Templates de mensagem por tenant, chaveados por finalidade, ex.:
    # {"contact_customer_attempt_1": "...", "radius_denied": "...", ...}
    message_templates: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
