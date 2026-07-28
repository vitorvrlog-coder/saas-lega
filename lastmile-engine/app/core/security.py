"""
Duas coisas distintas neste módulo:

1. Autenticação dos endpoints internos (fila humana / consulta de
   ocorrências) via chave compartilhada — não pelo webhook do gateway
   WhatsApp, que não carrega nenhuma credencial (o evolution-go não assina
   webhooks; ver whatsapp-saas/backend/app/api/whatsapp.py, referência já
   validada). Se INTERNAL_API_KEY não estiver configurada, a checagem é
   pulada — só aceitável em desenvolvimento local.

2. Hash de senha dos usuários do dashboard (app.db.models.user.User) — bcrypt
   direto (sem passlib, evita os problemas de compatibilidade de versão
   entre passlib e bcrypt novos).
"""
import bcrypt
from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def normalize_email(email: str) -> str:
    """Sempre aplicado antes de gravar OU comparar um e-mail de usuário —
    sem isso, "Joao@x.com" no cadastro e "joao@x.com" no login são
    tratados como contas diferentes (comparação de string é case-sensitive
    por padrão no Postgres) e o login falha mesmo com a senha certa."""
    return email.strip().lower()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # hash malformado/vazio — nunca deixa isso virar exceção 500 numa
        # tentativa de login, só trata como senha incorreta.
        return False


async def require_internal_api_key(
    x_internal_api_key: str | None = Header(default=None),
) -> None:
    settings = get_settings()

    if settings.INTERNAL_API_KEY is None:
        return

    if x_internal_api_key != settings.INTERNAL_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key inválida ou ausente.",
        )
