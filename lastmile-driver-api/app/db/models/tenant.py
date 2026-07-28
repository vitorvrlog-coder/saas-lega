"""
Tenant = operação/cliente do SaaS (transportadora ou embarcador).

Concentra tudo que o requisito de multi-tenant exige que NÃO seja hardcoded:
raio permitido, timeouts de tentativa 1/2 e templates de mensagem. Também
guarda as credenciais da instância evolution-go (gateway WhatsApp não-oficial)
usadas pra enviar mensagem desse tenant.
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

    # evolution-go — instância e token dedicados desse tenant no gateway
    # WhatsApp não-oficial (provisionados via create_evolution_instance).
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
    # — sempre texto livre, evolution-go não exige template pré-aprovado.
    message_templates: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    # Modo "full" — quando ligado, a IA nunca escala pra operador humano
    # (nem fila humana, nem ESCALATED_TO_HUMAN): reformula a pergunta pro
    # motorista/cliente e tenta de novo, indefinidamente se preciso, em vez
    # de esperar alguém preencher a fila ou resolver a escalação. Ver
    # app.state_machine.transitions (parâmetro full_autonomous_mode).
    full_autonomous_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # Produto de nota fiscal via app (motorista sem planilha de rota,
    # confirma pedido/endereço preventivamente antes da tentativa de
    # entrega) — desligado por padrão pra piloto controlado por tenant. Ver
    # app.api.v1.driver / app.services.invoice_service.
    preventive_contact_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
