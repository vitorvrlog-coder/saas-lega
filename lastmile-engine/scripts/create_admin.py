"""
Cria (ou promove) o primeiro admin da plataforma — não existe fluxo de
auto-cadastro no dashboard, então esse é o único jeito de criar o usuário
que depois cria todos os outros (admins e operadores de tenant) pela
própria UI (tela de detalhe do tenant).

Uso (de dentro do container, ou do host com o .env apontando pro banco certo):
    python -m scripts.create_admin --email admin@heimdall.com --password "senha-forte-aqui"

Senha via argumento (não getpass) de propósito: getpass exige um terminal
de verdade e trava silenciosamente em alguns ambientes (confirmado aqui —
Git Bash no Windows). Como é um script rodado uma vez pelo próprio dono da
plataforma, direto no servidor, o pequeno risco de sobrar no histórico do
shell é aceitável — troque a senha depois se preferir.

Se o e-mail já existir, promove o usuário existente a admin da plataforma
(tenant_id=None, is_platform_admin=True) em vez de falhar — útil se um
operador de tenant precisar virar admin.
"""
import argparse
import asyncio

from sqlalchemy import select

from app.core.security import hash_password, normalize_email
from app.db.models.user import User
from app.db.session import AsyncSessionLocal


async def create_or_promote_admin(email: str, password: str) -> None:
    email = normalize_email(email)
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(password),
                tenant_id=None,
                is_platform_admin=True,
                is_active=True,
            )
            db.add(user)
            action = "criado"
        else:
            user.password_hash = hash_password(password)
            user.tenant_id = None
            user.is_platform_admin = True
            user.is_active = True
            action = "promovido a admin da plataforma"

        await db.commit()
        print(f"Usuário '{email}' {action} com sucesso.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="E-mail do admin da plataforma")
    parser.add_argument("--password", required=True, help="Senha (mínimo 8 caracteres)")
    args = parser.parse_args()

    if len(args.password) < 8:
        raise SystemExit("Senha precisa ter pelo menos 8 caracteres.")

    asyncio.run(create_or_promote_admin(args.email, args.password))


if __name__ == "__main__":
    main()
