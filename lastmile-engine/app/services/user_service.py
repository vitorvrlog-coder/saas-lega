"""
Gestão de usuários do dashboard (app.web). Um admin da plataforma cria
operadores pela tela de detalhe do tenant — não existe auto-cadastro. O
primeiro admin da plataforma é criado fora daqui, via scripts/create_admin.py
(não tem outro operador logado ainda pra criar o primeiro).
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, normalize_email
from app.db.models.user import User


class DuplicateEmailError(Exception):
    pass


async def _email_exists(db: AsyncSession, email: str) -> bool:
    result = await db.execute(select(User.id).where(User.email == email))
    return result.scalar_one_or_none() is not None


async def create_tenant_operator(
    db: AsyncSession, *, tenant_id: uuid.UUID, email: str, password: str, is_tenant_admin: bool = False
) -> User:
    email = normalize_email(email)
    if await _email_exists(db, email):
        raise DuplicateEmailError(f"Já existe um usuário com e-mail '{email}'.")

    user = User(
        tenant_id=tenant_id,
        email=email,
        password_hash=hash_password(password),
        is_platform_admin=False,
        is_tenant_admin=is_tenant_admin,
    )
    db.add(user)
    await db.flush()
    return user


async def set_user_active(db: AsyncSession, user: User, is_active: bool) -> User:
    user.is_active = is_active
    await db.flush()
    return user


async def set_tenant_admin(db: AsyncSession, user: User, is_tenant_admin: bool) -> User:
    """Promove/rebaixa um operador a admin do próprio tenant (pode
    criar/ativar/desativar os outros operadores) — só quem já é admin da
    plataforma pode chamar isso (checado na rota, não aqui)."""
    user.is_tenant_admin = is_tenant_admin
    await db.flush()
    return user


async def set_primary_admin(db: AsyncSession, user: User, is_primary_admin: bool) -> User:
    """Promove/remove o admin principal do tenant (no máximo 1, garantido
    por índice único parcial na migration). Ao promover, rebaixa quem já
    era admin principal ANTES de setar o novo — senão o índice único
    rejeitaria os dois com is_primary_admin=True ao mesmo tempo no flush —
    e força is_tenant_admin=True, já que admin principal é sempre também
    admin de tenant. Quem pode chamar isso é checado na rota, não aqui."""
    if is_primary_admin:
        result = await db.execute(
            select(User).where(
                User.tenant_id == user.tenant_id,
                User.is_primary_admin.is_(True),
                User.id != user.id,
            )
        )
        for other in result.scalars().all():
            other.is_primary_admin = False
        user.is_tenant_admin = True
        # Flush a demoção ANTES de setar o novo — o índice único parcial
        # rejeita se as duas UPDATEs (demote + promote) caírem no mesmo
        # flush, já que a ordem entre elas não é garantida (confirmado por
        # teste real: passava isolado, falhava na suíte inteira).
        await db.flush()
    user.is_primary_admin = is_primary_admin
    await db.flush()
    return user


async def update_own_profile(db: AsyncSession, user: User, name: str, phone: str) -> User:
    user.name = name.strip() or None
    user.phone = phone.strip() or None
    await db.flush()
    return user


async def delete_user(db: AsyncSession, user: User) -> None:
    """Remoção definitiva da conta — diferente de desativar (set_user_active),
    aqui não sobra nem o login pra reativar depois. Nenhuma tabela de
    negócio referencia User via FK (ocorrências não têm dono, só tenant),
    então apagar não perde nem trava histórico nenhum."""
    await db.delete(user)
    await db.flush()


async def set_user_password(db: AsyncSession, user: User, new_password: str) -> User:
    """Reaproveitada tanto pela troca autoatendida (usuário confirma a
    senha atual antes de chamar isso) quanto pelo reset feito por uma
    autoridade (admin da plataforma ou admin do tenant, sem precisar da
    senha atual) — a diferença de quem pode chamar e se pede a senha atual
    é responsabilidade da rota, não desta função."""
    user.password_hash = hash_password(new_password)
    await db.flush()
    return user
