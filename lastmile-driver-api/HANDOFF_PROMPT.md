# Prompt de continuação — Heimdall Logtech (lastmile-driver-api)

Cole isto como primeira mensagem num chat novo do Claude Code pra continuar de onde a sessão anterior parou.

---

## O que é o projeto

**Heimdall Logtech**: SaaS que automatiza tratamento de insucessos de entrega last-mile via WhatsApp + IA (B2B, transportadoras) e tem um produto novo de assinatura paga do motorista com captura automática de rota (B2C). Repositório GitHub: `vitorvrlog-coder/saas-lega`, branch de trabalho: **`import-vps-project`** (ainda não mergeada em `main`).

Infra: VPS Oracle Cloud (`147.15.99.10` / `heimdall-logtech.com`), Docker Compose (Postgres + evolution-go + `lastmile-engine` na raiz; `lastmile-driver-api` com compose próprio), Nginx + Let's Encrypt pros domínios `app.`, `motorista.`, `driverapp.`.

Dois backends no repo:
- **`lastmile-engine`** — em produção, mais antigo, usa evolution-go (gateway WhatsApp não-oficial), 22 arquivos de teste.
- **`lastmile-driver-api`** — mais novo, superset do engine: auth de motorista, assinatura paga (Asaas), captura de rota via OCR. Foi o foco principal da sessão anterior.

## O que foi feito na sessão anterior, em ordem

### 1. Recuperação de acesso à VPS
Chave SSH original estava perdida. Recuperada via: instância de resgate na Oracle Cloud + troca de boot volume + correção de nome de grupo LVM (`vgimportclone`/`vgrename`) que tinha sido alterado sem querer durante o processo. Chave nova funcional: `~/.ssh/heimdall_recovery` no Cloud Shell da Oracle.

**Achado importante**: a instância chamada `heimdall-vps-micro` NÃO é a que hospeda o domínio — é a `instance-20260708-1744` (IP `147.15.99.10`).

### 2. Importação do projeto real para o GitHub
Projeto real estava só na VPS (`/home/opc`), nunca tinha ido pro GitHub. Importado pra branch `import-vps-project`, excluindo `.env`, `.secrets/`, `.bash_history` etc.

### 3. Incidentes de segurança tratados
- Dois tokens do GitHub foram colados em texto puro no chat durante o processo — **ainda pendente revogar** em https://github.com/settings/tokens (não foi feito, ficou combinado "depois").
- `lastmile-driver-api/docker-compose.yml` tinha senha do Postgres, `SECRET_KEY` e `INTERNAL_API_KEY` **hardcoded** — corrigido pra usar variáveis de ambiente (`${DRIVER_POSTGRES_PASSWORD}`, `${DRIVER_SECRET_KEY}`, `${DRIVER_INTERNAL_API_KEY}`, `${EVOLUTION_GLOBAL_API_KEY}`). **As credenciais antigas continuam nos primeiros commits do histórico do git e precisam ser rotacionadas de verdade na VPS** (não só substituídas no arquivo).

### 4. Reversão do gateway WhatsApp no `lastmile-driver-api` (evolution-go, não mais Cloud API da Meta)
Motivo: aprovação de template da Meta nunca saiu do "pendente", travando o lançamento.
- Copiado `evolution_api` do engine pro driver-api, removido `whatsapp_cloud`.
- Todo envio agora é texto livre direto (`client.send_text()`), sem janela de 24h/templates aprovados.
- `webhooks.py` reescrito pro formato do evolution-go.
- Reintroduzido fluxo de QR code de pareamento (necessário de novo pro evolution-go).
- Nova migration Alembic: `a1c4e8f2b9d6` (renomeia colunas de volta pra `evolution_instance`/`evolution_token`).
- Corrigido o `docker-compose.yml` inseguro (item 3 acima) na mesma leva.

### 5. Suíte de testes no driver-api (tinha zero antes)
187 → depois 189 testes: 172 portados do `lastmile-engine` (adaptados automaticamente) + testes novos pras features exclusivas (login de motorista, assinatura Asaas, captura de rota, notas fiscais). Validado localmente: app importa limpo, todos os testes coletam sem erro, os que não dependem de Postgres real (32) passam.

### 6. Organização do repositório
README na raiz, `.gitignore` limpo (removidos dotfiles de shell e logs do certbot que tinham vazado do home da VPS).

### 7. Checkout de cartão próprio pra assinatura do motorista
Trocado o link de pagamento hospedado pelo Asaas por uma página própria (`/checkout/{token}`, sem login, token assinado de uso restrito válido 7 dias).
- `start_subscription`: só cria customer no Asaas + manda link do checkout por WhatsApp — nenhuma cobrança existe ainda.
- `capture_subscription_card` (novo, chamado da página de checkout): tokeniza o cartão via API do Asaas e só então cria a assinatura recorrente real (`billingType=CREDIT_CARD`) — **cartão em arquivo é o único jeito de ter cobrança automática de verdade** (PIX exigia pagamento manual a cada ciclo).
- Novo status `card_declined` no webhook pra recusa de cartão/análise de risco.
- Cuidado: dado de cartão nunca é logado (nem em erro).
- Nova migration: `c7f3a9e1d5b8` (email do motorista, token de cartão, novo valor de enum).

**⚠️ Decisão consciente tomada**: o Asaas não tem tokenização client-side (tipo Stripe.js) — o cartão passa pelo nosso backend antes de virar token, o que coloca a aplicação em escopo PCI-DSS. O usuário decidiu aceitar esse escopo e seguir mesmo assim (avaliar certificação/SAQ formalmente é discussão separada, fora do código).

**⚠️ Duas coisas da documentação pública do Asaas divergiram e precisam ser confirmadas contra o sandbox real antes de produção:**
1. Path exato do endpoint de tokenização (ficou `/creditCard/tokenizeCreditCard`, mas a doc também mostrou `/creditCard/tokenize`).
2. Se `remoteIp` é obrigatório no reuso de token de cartão.

**⚠️ Bloqueio operacional (não técnico)**: tokenização de cartão em produção no Asaas exige contato manual com o gerente de conta — sandbox já vem habilitado, produção não.

### 8. Estratégia de marketing (discussão, sem código)
Público-alvo definido: motoristas (B2C), fase de primeiros pagantes, budget de teste até R$1.000/mês. Recomendação dada: Meta Ads (Reels), 1 canal só, 2 criativos testados em sequência (não paralelo), geo restrito a 1 cidade piloto, meta de 20-40 assinantes-teste pra validar CAC antes de pedir mais verba.

## Estado atual — o que falta

Tudo commitado e enviado pro GitHub (`import-vps-project`), **mas nada disso foi aplicado na VPS ainda**. Pendências, em ordem sugerida:

1. **Revogar os 2 tokens do GitHub** expostos no chat (https://github.com/settings/tokens).
2. **Rotacionar de verdade** a senha do Postgres, `SECRET_KEY`, `INTERNAL_API_KEY` do `lastmile-driver-api` na VPS (não só no arquivo — as antigas ainda funcionam até serem trocadas no banco/serviço real).
3. Encerrar as instâncias temporárias `rescue-temp2`/`rescue-ubuntu` na Oracle Cloud (custo à toa).
4. Limpar `history -c` do bash na VPS.
5. Na VPS: `git pull` da branch, rodar as duas migrations novas (`a1c4e8f2b9d6` e `c7f3a9e1d5b8`) com `alembic upgrade head`, criar `.env` do driver-api com as credenciais novas, rebuild + redeploy do container, rodar `pytest -q` contra o Postgres real.
6. Testar o checkout de cartão de ponta a ponta no sandbox do Asaas — confirmar o path de tokenização e o comportamento do `remoteIp` (itens acima).
7. Pedir ao Asaas a ativação de tokenização em produção (contato manual, fora do código).
8. Existe um Claude Code já instalado e logado direto na VPS (`ssh -i ~/.ssh/heimdall_recovery opc@147.15.99.10`, depois `cd /home/opc/lastmile-driver-api && claude`) — pode ser usado pra rodar os passos 5-6 sem precisar do vai-e-vem manual via Cloud Shell.

## Outras coisas mencionadas, ainda em aberto
- Estruturar/unificar `lastmile-engine` + `lastmile-driver-api` num só backend — **decisão explícita do usuário foi NÃO fazer isso por ora**, manter os dois separados.
- Checkout de pagamento das transportadoras (B2B) — ainda não existe, não foi este o escopo (só o do motorista/B2C).
