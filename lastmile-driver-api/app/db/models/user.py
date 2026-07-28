"""
User = operador humano que loga no dashboard (app.web). Quatro papéis:

- tenant_id=None, is_platform_admin=True: admin da plataforma — vê e
  gerencia todos os tenants (config de negócio, WhatsApp, operadores),
  inclusive a tela de Tenants.
- tenant_id preenchido, is_primary_admin=True: admin principal do tenant —
  no máximo 1 por tenant (garantido por índice único parcial na migration),
  designado só pelo admin da plataforma. Controle total sobre TODOS os
  usuários do próprio tenant, inclusive outros admins de tenant (ativar/
  desativar, resetar senha, promover/rebaixar admin, remover). Implica
  is_tenant_admin=True sempre — invariante garantida em
  app.services.user_service.set_primary_admin, não por CHECK constraint.
- tenant_id preenchido, is_tenant_admin=True (sem ser admin principal):
  representa a transportadora (cliente) — só enxerga o próprio tenant, pode
  criar/ativar/desativar/resetar senha de operadores NÃO-admin desse
  tenant; não pode mexer em outros admins (só o admin principal ou o admin
  da plataforma podem) nem promover ninguém a admin de tenant.
- tenant_id preenchido, is_tenant_admin=False: operador comum, só enxerga
  ocorrências/fila/escalações do próprio tenant.

Não existe fluxo de auto-cadastro: admins da plataforma criam operadores
pela tela de detalhe do tenant (app.web.routes), e o primeiro admin é
criado via scripts/create_admin.py.
"""
import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True
    )

    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

    is_platform_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    is_tenant_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    is_primary_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
