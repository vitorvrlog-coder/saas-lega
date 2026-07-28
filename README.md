# Heimdall Logtech

SaaS que automatiza o tratamento de insucessos de entrega last-mile B2C via WhatsApp + IA, ponte entre motoristas e clientes finais para transportadoras (tenants). Inclui também um produto B2C separado: assinatura paga para o motorista, com captura automática de rota a partir de prints do app de entrega (Mercado Livre/Shopee).

## Estrutura do repositório

```
lastmile-engine/          Backend em produção (app.heimdall-logtech.com) — motor de decisão
                           de insucessos, gateway WhatsApp evolution-go, multi-tenant.
lastmile-driver-api/       Backend mais recente, superset do engine: autenticação e
                           assinatura paga do motorista (Asaas), captura de rota via OCR,
                           também sobre o gateway evolution-go.
marketing-site/            Site institucional estático (heimdall-logtech.com).
driver-marketing-site/     Site de captação de motoristas estático (motorista.heimdall-logtech.com),
                           inclui o .apk do app para download.
marketing-nginx-conf.d/    Configuração Nginx dos domínios acima + proxy reverso pro backend.
certbot/                   Scripts e configuração de renovação de certificado Let's Encrypt
                           (dados de runtime — certificados e logs não versionados).
docker-compose.yml         Orquestra postgres + evolution-go + lastmile-engine (produção).
init-db.sh                 Cria os bancos/usuários do Postgres compartilhado no primeiro boot.
templates.json             Templates de mensagem padrão (texto livre, sem exigência de
                           aprovação — gateway é o evolution-go, não a API oficial da Meta).
```

Cada backend (`lastmile-engine/`, `lastmile-driver-api/`) tem seu próprio `docker-compose.yml`, `requirements.txt`, `tests/` e `README`/documentação interna — ver `CLAUDE_CODE_HANDOFF.md` e `HANDOFF_PROMPT.md` dentro de `lastmile-engine/` para o histórico de decisões de produto e arquitetura.

## Stack

- **Backend**: Python + FastAPI (async), SQLAlchemy 2.0 + asyncpg, PostgreSQL, migrations via Alembic
- **IA**: Ollama (local) ou Anthropic Claude, plugável por variável de ambiente
- **WhatsApp**: gateway não-oficial `evolution-go` (fork em Go baseado em whatsmeow)
- **Dashboard**: Jinja2 + HTMX + Pico.css, server-rendered
- **Infra**: Docker Compose, Nginx + Let's Encrypt, Oracle Cloud (Ampere ARM, Always Free)

## Segurança

- `.env`, `.secrets/` e credenciais nunca devem ser commitados — ver `.gitignore`.
- `docker-compose.yml` de cada serviço usa variáveis de ambiente (`${VAR}`) para segredos, nunca valores hardcoded.
- Rotação de credenciais expostas acidentalmente deve ser feita imediatamente (Postgres, `SECRET_KEY`, `INTERNAL_API_KEY`, tokens do Asaas/evolution-go).

## Desenvolvimento

Cada backend roda de forma independente. Dentro de `lastmile-engine/` ou `lastmile-driver-api/`:

```bash
cp .env.example .env        # preencher com credenciais locais
pip install -r requirements-dev.txt
alembic upgrade head
pytest -q
```

Deploy em produção (VPS): `docker compose build <serviço> && docker compose up -d --force-recreate <serviço>`, depois conferir `docker logs <container> --tail 20`.
