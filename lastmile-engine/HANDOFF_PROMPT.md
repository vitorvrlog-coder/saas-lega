# Prompt de continuação — Heimdall Logtech (lastmile-engine)

Cole isto como primeira mensagem num chat novo do Claude Code, já dentro do diretório do projeto (`C:\Users\User\Claude\Projects\Saas monitoramento\lastmile-engine`).

---

## O que é o projeto

**Heimdall Logtech** é um SaaS que automatiza o tratamento de insucessos de entrega last-mile B2C via WhatsApp + IA, para transportadoras (tenants). Stack: FastAPI (async, SQLAlchemy 2.0 + asyncpg), Postgres, Alembic, evolution-go (fork do Evolution API baseado em whatsmeow, gateway de WhatsApp **não-oficial**), Ollama (`qwen2.5:3b`) ou Anthropic como provedor de IA plugável, Jinja2 + HTMX + Pico.css pro dashboard server-rendered.

Fluxo: motorista reporta insucesso via WhatsApp → IA classifica motivo → (se faltar telefone/endereço do cliente) planilha de rota importada ou fila humana preenche → sistema contata cliente final → IA classifica resposta do cliente → aprova/nega novo endereço por raio, ou fecha como reagendado/insucesso definitivo.

### Credenciais / ambiente (local, docker compose)
- Admin da plataforma: `admin@heimdall.com` (senha não confirmada nesta sessão — a documentada anteriormente parou de funcionar; a senha válida hoje é `senha12345` no tenant admin `111@heimdall.com`, não no platform admin).
- Tenant admin ativo: `111@heimdall.com` / `senha12345` (tenant HEIMDALL JOINVILLE, `is_tenant_admin=True`).
- App: `http://localhost:8001` (container `lastmile-engine-api`)
- Postgres: container `whatsapp-saas-postgres` (compartilhado com projeto irmão whatsapp-saas), banco `lastmile_engine`, user `lastmile`/`lastmile`.
- evolution-go: `http://localhost:8080` (mesmo compose do whatsapp-saas)
- Tenant ativo: **HEIMDALL JOINVILLE** (instância `vrlogistica`, WhatsApp pareado, `LoggedIn: true` confirmado no início desta sessão).

## Estado atual: funcionando, feature grande nova no ar (Etapa 1 de 4 do roadmap de automação)

## Sessão anterior (resumo, já implementado e validado): cadeia de bugs reais do fluxo de mensagens + retracbilidade + fix de duplicação de ocorrência + rede de segurança de classificação + humanização de templates + timestamps BR. Detalhes completos não repetidos aqui — ver histórico do projeto/git se precisar, o essencial é: **tudo isso está funcionando em produção local**, validado com testes reais.

## Trabalho desta sessão

### 1. Redesign visual do cabeçalho e login
- Menu "Chamadas" e "Tenant" viraram dropdowns (categorias) em vez de itens soltos — `app/templates/base.html`, classe CSS nova `.nav-dropdown` em `app/static/style.css`.
- Emblema da marca (logo com moldura circular dourada) unificado num componente só, `.heimdall-emblem` (+ modificadores `--sm`/`--lg`), reaproveitado no cabeçalho e no login — antes eram 3 estilos quase-duplicados.
- Cabeçalho com sombra de elevação, estado "ativo" por página, hover em pílula. Login com cartão maior/mais arredondado.
- Aplicado tanto no `/web` (base.html) quanto no `/backoffice` (backoffice_base.html), que compartilham o mesmo CSS.

### 2. Discussões estratégicas de negócio (decisões e conclusões, sem código)
- **Precificação**: recomendado plano em faixas de volume (ocorrências/mês) + excedente, ancorado em ~20-35% do custo de analista humano substituído (~R$4-7k/mês incluindo encargos CLT) → sugestão de faixa R$1.200-2.000/mês por tenant.
- **API oficial do WhatsApp**: pesquisado custo real (mensagens utility ~R$0,07-0,12, service grátis dentro de 24h) — muito barato. Caminho recomendado: virar "Tech Provider"/Solution Partner da Meta (não BSP terceiro), com Embedded Signup pra self-serve de novos tenants. **Ainda não migrado** — é decisão de timing, não bloqueador técnico.
- **Risco de escala nacional**: o gateway não-oficial (evolution-go/whatsmeow) piora de risco conforme a base cresce (mais volume = mais detectável pela Meta), e um banimento pode afetar várias transportadoras simultaneamente (mesmo container). Recomendado: migrar pra API oficial ANTES de vender agressivamente pra novos tenants, não depois.
- **Integração com Mercado Livre**: avaliado — tecnicamente existe API de Mercado Envios com dados de shipment, mas o acesso é institucional (ME1 = dado pertence ao vendedor, não à transportadora; ME2 = exige virar agência parceira homologada pela Meli). Não é self-service. Recomendado como frente de pesquisa/BD em paralelo, não pausar o roadmap de engenharia por isso.
- **Gateway de pagamento próprio**: avaliado e descartado — processar cartão/PIX como participante direto exige virar instituição de pagamento autorizada pelo Bacen (anos, capital regulatório). Alternativa real de baixo custo: PIX direto via API do próprio banco PJ (Banco Inter, Efí, Nubank PJ) em vez de gateway terceiro, quase sem taxa. **Usuário disse ter uma ideia futura própria pra isso — não detalhada, decisão adiada por ele.**

### 3. Tentativa de provisionar VPS (Oracle Cloud) — EM ANDAMENTO, travado
- Escolhida Oracle Cloud "Always Free" (Ampere A1 Flex, 4 OCPU/24GB, grátis permanente) em vez de pagar Hostinger KVM4 (R$54,99/mês).
- Conta criada, chave SSH já gerada em **`C:\Users\User\.ssh\heimdall_oracle_vps`** (privada) / `.pub` (pública, já usada na criação da instância).
- **Travado em "Out of host capacity"** pro shape Ampere A1 Flex — fila de capacidade real da Oracle, sem previsão. Usuário optou por continuar tentando (grátis) em vez de pagar, mesmo sabendo que atrasa o lançamento.
- **Não tentar** criar segunda conta Oracle pra contornar (viola ToS, risco de suspensão da conta já existente) — já descartado explicitamente na conversa.
- Próxima ação quando destravar: seguir o passo-a-passo já validado (Shape → Ampere → A1.Flex → 4 OCPU/24GB confirmado nos campos "Number of OCPUs"/"Amount of memory" — não só no resumo, que às vezes mostra texto genérico desatualizado; Networking → Create new **public** subnet + toggle de IP público; SSH → Paste public key).

### 4. Feature grande implementada: Perfil de Motorista + Planilha de Rota (Etapa 1 de 4)

Plano completo em `C:\Users\User\.claude\plans\fizzy-fluttering-rabbit.md`. Contexto: fechar a lacuna de quando o motorista relata insucesso sem telefone/endereço do cliente (hoje trava em `pending_human_queue` esperando operador).

**Construído e validado (154 testes passando, deploy feito, smoke test manual ok):**
- Modelo `Driver` (`app/db/models/driver.py`) — cadastro persistente por tenant (telefone único + nome + veículo), criado automaticamente no primeiro relato via `driver_service.get_or_create_driver`. `Occurrence.driver_id` é FK aditiva (SET NULL), não substitui `driver_phone`/`driver_name`.
- Modelos `RouteManifest`/`RouteManifestEntry` (`app/db/models/route_manifest.py`) — planilha de rota importada (xlsx/csv via `openpyxl` + `csv` stdlib), com colunas `stop_number, driver_phone, customer_name, customer_phone, address, route_id`.
- `app/services/manifest_service.py` — parse com validação (nunca adivinha coluna/linha inválida), `find_manifest_entry(tenant_id, driver_phone, stop_number)` busca o manifesto mais recente em caso de reupload de correção no mesmo dia.
- **Gancho de auto-preenchimento**: `FailureClassificationOutput` ganhou campo `stop_number` (IA extrai se o motorista citar "parada X"); em `occurrence_service.handle_driver_report`, se a classificação ia pra `pending_human_queue` mas veio `stop_number` e bate com uma entrada da planilha (com telefone+endereço preenchidos), a ocorrência pula direto pra `contacting_customer_attempt_1` — mesmo efeito de um operador preenchendo manualmente, mas automático e sem custo de IA extra (continua só Ollama).
- Rotas novas: `/web/drivers`, `/web/drivers/{id}`, `/web/manifests`, `/web/manifests/new`, `/web/manifests/{id}` — no menu "Chamadas".
- Migração `233691e8df81` aplicada (tabelas `drivers`, `route_manifests`, `route_manifest_entries` + coluna `occurrences.driver_id`).
- **Ainda não testado ao vivo**: o gancho de auto-preenchimento com IA real (Ollama) reconhecendo "parada X" numa mensagem de motorista de verdade — a lógica está coberta por teste com IA simulada, mas vale mandar uma mensagem real de teste quando puder.

### 5. Roadmap restante (não iniciado, só desenhado em conversa — decisões já tomadas, não perguntar de novo)

- **Etapa 2 — Painel de saúde dos tenants** (backoffice): nova rota `/backoffice/health`, agregando status WhatsApp (via `tenant_service.get_tenant_connection_status`, **com `asyncio.gather(return_exceptions=True)`** pra não serializar N chamadas HTTP externas) + volume de mensagens/IA das últimas 24h (`MessageLog`/`AIDecisionLog` agrupados por tenant). Sem schema novo.
- **Etapa 3 — Botão de confirmação do motorista no WhatsApp**: usuário confirmou querer **botão ativo** (não só "lido" passivo). Desenho: `EvolutionButton`/`client.send_buttons()` já existem no código (`app/integrations/evolution_api/client.py`) mas nunca foram chamados — usar nos 3 pontos onde hoje se manda aviso de fechamento por `send_text`. **Não é transição de máquina de estado** (estados fechados são terminais por design, `ALLOWED_TRANSITIONS` vazio pra eles) — é flag lateral (`driver_confirmation_requested_at`/`acked_at`), igual ao padrão de `driver_followup_acked`. **Ponto crítico**: precisa inserir uma checagem nova em `handle_inbound_message` ANTES de `find_open_occurrence_for_driver` (que exclui estados terminais) — senão um toque no botão de uma ocorrência já fechada vira um relato novo por engano.
- **Etapa 4 — SAC**: chamados de suporte do tenant admin pra equipe Heimdall (confirmado: não é suporte motorista/cliente). Recomendado v1: modelo único `SupportTicket` + `TicketStatus` enum (status simples, sem thread de mensagens) — **atenção**: todo enum novo neste projeto precisa do padrão `PGEnum(..., create_type=False, values_callable=_values)` (já é bug real documentado no código, ex: `occurrence.py:32-36`), senão quebra em runtime com `LookupError` mesmo passando no `alembic --sql`.
- **Cobrança recorrente**: gateway ainda não escolhido (usuário tem ideia própria futura, não detalhada). Recomendação dada: Mercado Pago Assinaturas se decidir usar gateway terceiro.

## Convenções estabelecidas (seguir sempre)

- **Nunca confiar em suposição sobre formato externo** — sempre confirmar contra código-fonte real ou teste ao vivo.
- **Testar contra infraestrutura real**: Postgres real, Ollama real, evolution-go real.
- **Todo deploy**: `docker compose build` → `docker compose up -d --force-recreate` (conferir "Recreated") → `docker logs lastmile-engine-api --tail 15` (startup limpo).
- **Rodar a suíte de testes antes de cada deploy**: `.venv/Scripts/python.exe -m pytest -q` (154 testes passando no final desta sessão). Aplicar migrations pendentes com `.venv/Scripts/python.exe -m alembic upgrade head` antes de rodar os testes.
- Ao testar features ao vivo criando dados sintéticos, **sempre limpar depois** (`DELETE FROM ...`).
- Migrations via Alembic — gerar com `alembic revision --autogenerate`, sempre revisar antes de aplicar.
- Sem comentários explicando O QUÊ o código faz — só o PORQUÊ quando não é óbvio.
- Mensagem pro motorista **sempre** vem de template configurado do tenant — a IA nunca gera texto livre pra ele.
- Ações destrutivas em infra compartilhada pedem confirmação explícita antes de executar.
- **Nunca aceitar senha/credencial colada em texto no chat** — se o usuário mandar, avisar pra trocar e nunca usar aquele valor.
- Mudanças não-triviais de arquitetura passam por Plan Mode antes de codar (fizemos isso pra Etapa 1, funcionou bem — 3 agentes de exploração em paralelo + 1 agente de design antes do plano final).

## Pendências específicas pra próxima sessão

1. **VPS Oracle**: continuar tentando criar a instância Ampere A1 Flex (fila de capacidade). Chave SSH já pronta em `C:\Users\User\.ssh\heimdall_oracle_vps`.
2. **Domínio**: usuário ia providenciar, sem retorno ainda sobre qual escolheu.
3. Testar ao vivo o gancho de auto-preenchimento por planilha com motorista real citando "parada X".
4. Perguntar se quer seguir pra Etapa 2 (painel de saúde) ou mudar prioridade.
5. A extensão Claude in Chrome ficou desconectada a sessão inteira — se for fazer verificação visual de novo, checar se reconectou antes de tentar depender dela.

## Como retomar

Depois de colar este prompt, comece confirmando `docker ps`, `docker logs lastmile-engine-api --tail 20`, e o status da sessão WhatsApp (`docker exec whatsapp-saas-evolution-go wget -qO- --header="apikey: <token do tenant>" http://localhost:8080/instance/status/vrlogistica`). Se o usuário já tiver testado mais coisas desde a última mensagem dele (incluindo a VPS), pergunte o que mudou antes de assumir que está tudo como deixamos.
