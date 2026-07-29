"""
Configuração central via variáveis de ambiente (pydantic-settings).
Nenhum segredo ou valor de negócio (raio, timeout, template) é hardcoded
aqui — valores de negócio por tenant vivem na tabela `tenants`; isto aqui
é só infraestrutura (conexões, chaves de API, seleção de provedor de IA).
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Banco de dados ---
    # URL assíncrona (usada pela aplicação em runtime, via asyncpg)
    DATABASE_URL: str = "postgresql+asyncpg://lastmile:lastmile@postgres:5432/lastmile_engine"

    # --- Gateway WhatsApp (evolution-go, reaproveitado do stack heimdall) ---
    EVOLUTION_BASE_URL: str = "http://heimdall-evolution-go:8080"
    # Chave mestre do evolution-go — só usada pra criar instância nova
    # (POST /instance/create) no onboarding de um tenant. Operações do
    # dia a dia (enviar msg, conectar, QR) usam o token da própria
    # instância (Tenant.evolution_token), nunca essa chave.
    EVOLUTION_GLOBAL_API_KEY: str | None = None
    # Endereço deste próprio serviço, visível de dentro da rede docker —
    # é pra onde a instância recém-criada no evolution-go manda os
    # webhooks (não pode ser "localhost", isso apontaria pro próprio
    # container do evolution-go).
    WEBHOOK_BASE_URL: str = "http://heimdall-driver-api:8000"

    # --- Provedor de IA, trocável sem alterar código de negócio ---
    AI_PROVIDER: str = "ollama"  # "ollama" | "anthropic"

    OLLAMA_BASE_URL: str = "http://ollama:11434"
    OLLAMA_MODEL: str = "llama3.1"

    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_MODEL: str = "claude-haiku-4-5"

    # --- Geocoding ---
    GEOCODING_PROVIDER: str = "nominatim"
    GEOCODING_API_KEY: str | None = None

    # --- OCR de nota fiscal fotografada (app.services.invoice_extraction_service) ---
    # Default assume tesseract no PATH (caso do container, via apt install
    # tesseract-ocr no Dockerfile). Em dev local no Windows, o binário não
    # entra no PATH sozinho — sobrescreva no .env com o caminho completo do
    # tesseract.exe.
    TESSERACT_CMD: str = "tesseract"
    # Idem — só necessário em dev local no Windows quando o instalador não
    # registra o diretório de dados de idioma no local padrão do binário.
    TESSDATA_PREFIX: str | None = None

    # --- App ---
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    # --- Asaas (gateway de pagamento — assinatura paga do motorista, "adesão") ---
    # Sandbox por padrão — trocar pra "production" só quando for cobrar de
    # verdade. Nunca commitar a chave real; vem de .env / clipboard, igual
    # ao token da Meta.
    ASAAS_ENV: str = "sandbox"  # "sandbox" | "production"
    ASAAS_API_KEY: str | None = None
    # Valor arbitrário nosso, conferido contra o header "asaas-access-token"
    # de todo webhook recebido — cadastrado manualmente no painel Asaas
    # (Configurações > Webhooks), mesmo princípio da checagem de webhook.
    ASAAS_WEBHOOK_TOKEN: str | None = None
    # Preço mensal da assinatura do motorista — decisão de negócio, não
    # hardcoded no service, pra poder ajustar sem deploy de código.
    DRIVER_SUBSCRIPTION_VALUE: float = 35.00

    @property
    def ASAAS_BASE_URL(self) -> str:
        return "https://api-sandbox.asaas.com/v3" if self.ASAAS_ENV == "sandbox" else "https://api.asaas.com/v3"

    # Endereço PÚBLICO deste serviço (diferente de WEBHOOK_BASE_URL, que é
    # só pra tráfego interno docker do evolution-go) — usado pra montar o
    # link da página de checkout de cartão (app.web.checkout_routes),
    # aberto direto do navegador do celular do motorista a partir do
    # WhatsApp.
    PUBLIC_BASE_URL: str = "https://driverapp.heimdall-logtech.com"

    # --- Autenticação dos endpoints internos (fila humana / consulta de ocorrências) ---
    # None também liga o "bypass de dev" do dashboard web (app.web.auth):
    # todo mundo vira um admin da plataforma fantasma, sem precisar logar —
    # só aceitável em desenvolvimento local. Em produção, configure com um
    # valor forte pra exigir login de verdade (usuário/senha reais,
    # app.db.models.user.User).
    INTERNAL_API_KEY: str | None = None

    # --- Dashboard web (app.web) — assina o cookie de sessão do login
    # (que carrega o id do usuário logado). Troque em produção; com o
    # default, qualquer um que conheça o valor consegue forjar sessão.
    SECRET_KEY: str = "dev-insecure-secret-key-change-in-production"

    @property
    def SYNC_DATABASE_URL(self) -> str:
        """URL síncrona (psycopg2), usada apenas pelo Alembic para migrations."""
        return self.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


@lru_cache
def get_settings() -> Settings:
    return Settings()
