# Handoff — Motor de decisão de insucessos de entrega (last mile B2C)

Você vai continuar um projeto FastAPI já iniciado. Leia este prompt inteiro antes de gerar qualquer código. As decisões abaixo já foram tomadas e validadas com o usuário — não as questione, apenas implemente.

## Contexto do produto

Sistema que automatiza o tratamento de insucessos de entrega (last mile B2C), fazendo a ponte entre motoristas e clientes finais via WhatsApp, com IA decidindo o fluxo. Objetivo: reduzir atendimento humano tratando exceções repetitivas de entrega.

## Stack

- Backend: Python + FastAPI (async), projeto em `lastmile-engine/` dentro da pasta do usuário (mesmo nível de `whatsapp-saas/`, que é um projeto diferente e não deve ser tocado, só referenciado — ver seção "Gateway WhatsApp" abaixo).
- Banco: PostgreSQL, SQLAlchemy 2.0 (async, asyncpg em runtime; psycopg2 só para Alembic), migrations Alembic.
- IA: Ollama (modelo local) como primeira opção, com camada de abstração trocável por env var para Anthropic Claude Haiku 4.5. Nunca acoplar lógica de negócio a um provedor específico.
- Containerização: Docker + docker-compose, **reaproveitando a infraestrutura já existente do projeto `whatsapp-saas`** (mesmo Postgres físico com database própria, mesmo container evolution-go).

## Decisão crítica: gateway WhatsApp real

**Não é a Evolution API oficial.** É um fork em Go, `evoapicloud/evolution-go` (imagem `evoapicloud/evolution-go:0.7.1`), já rodando no docker-compose do projeto `whatsapp-saas` ao lado deste. Formato real (confirmado lendo o código do outro projeto, em `whatsapp-saas/backend/app/api/whatsapp.py` e `whatsapp-saas/backend/app/services/whatsapp_service.py`):

Webhook recebido (POST):
```json
{
  "event": "Message",
  "instanceName": "nome_da_instancia",
  "data": {
    "Info": { "Sender": "5511999999999@s.whatsapp.net", "IsFromMe": false },
    "Message": { "conversation": "texto da mensagem" }
  }
}
```
Ignorar se `IsFromMe: true`. Telefone = `Sender` com `@s.whatsapp.net` removido.

Envio (POST), autenticado via header `apikey: <evolution_token>`:
- Texto: `POST {EVOLUTION_BASE_URL}/send/text` com body `{"id": "<evolution_instance>", "number": "<phone>", "text": "..."}`
- Botões: `POST {EVOLUTION_BASE_URL}/send/button` com body `{"id", "number", "title", "description", "footer", "buttons": [...]}`

Se, ao implementar, o payload real observado divergir disso (ex: mensagem de áudio, formato de botão), pare e pergunte antes de assumir — não invente estrutura.

## Fluxo de negócio (máquina de estados) — seguir exatamente esta ordem

1. Motorista reporta insucesso via WhatsApp (texto, áudio transcrito, ou botões: ausente / endereço errado / recusado / avaria / área de risco).
2. IA classifica o motivo, retornando JSON estruturado: categoria, nível de confiança, se requer contato com cliente final. Exceção: se motivo = "recusado", pula contato com cliente e vai direto pra fechamento.
3. Ocorrência vai para fila de monitoramento humano — operador preenche manualmente ID da rota + contato do cliente (nome, telefone). Etapa temporária e **plugável/removível** (existe só até integração com TMS da transportadora).
4. IA contata o cliente final via WhatsApp, mensagem contextual ao motivo (tentativa 1).
5. Se o cliente responder: IA classifica a resposta (confirma reagendamento / pede novo endereço / recusa definitiva / ambígua). Se pedir mudança de endereço: geocodifica e calcula distância do endereço original.
   - Dentro do raio permitido (configurável por tenant, ex: 2km): aprova automaticamente, informa motorista com nova instrução, informa cliente que foi aprovado.
   - Fora do raio: nega automaticamente, explica política ao cliente, informa motorista para manter como insucesso.
   - A IA NUNCA repassa a resposta crua do cliente ao motorista — sempre resume em instrução acionável.
6. Se o cliente não responder no timeout (tentativa 1): dispara tentativa 2 automaticamente, sem passar de novo pela fila humana. Sem resposta na tentativa 2: fecha como insucesso definitivo, avisa motorista para seguir para o próximo endereço.

## Requisitos não-negociáveis

- Toda saída de IA é JSON estruturado, nunca texto livre interpretado por regex. Schema inválido → erro tratado, escala para revisão humana, nunca assume default silencioso.
- Auditoria completa: log de todas as mensagens trocadas, decisões da IA, timestamps de toda mudança de estado (disputa comercial/jurídica).
- Idempotência: mensagens duplicadas do WhatsApp (sinal ruim) não geram ocorrências nem contatos duplicados.
- Multi-tenant desde o início: cada cliente do SaaS configura seu próprio raio permitido, timeouts de tentativa 1/2, templates de mensagem — nunca hardcoded.
- Ambiguidade sempre escala para humano — a IA nunca decide sozinha em casos ambíguos ou de baixa confiança.

## O que já está pronto (não refazer, só usar/estender)

Em `lastmile-engine/`:

- `app/db/base.py` — Base declarativa SQLAlchemy com naming convention fixa para constraints.
- `app/db/models/enums.py` — enums de domínio (OccurrenceState, FailureReason, TransitionActor, MessageDirection, MessageParticipant, MessageContentType, AIDecisionType).
- `app/db/models/tenant.py` — `Tenant`: nome, slug, evolution_instance/token, allowed_radius_km, timeout_attempt_1/2_minutes, message_templates (JSONB), is_active.
- `app/db/models/occurrence.py` — `Occurrence`: registro central da máquina de estados (state, failure_reason, campos de motorista, campos preenchidos na fila humana, campos de mudança de endereço/raio, controle de tentativas, fechamento).
- `app/db/models/state_transition.py` — log append-only de transições de estado.
- `app/db/models/message_log.py` — log de mensagens trocadas (auditoria + idempotência via external_message_id).
- `app/db/models/ai_decision_log.py` — log de decisões de IA (input/output JSON, confiança, ambiguidade, escalonamento).
- `app/db/models/processed_event.py` — guarda de idempotência (unique tenant_id + external_message_id).
- `app/core/config.py` — Settings via pydantic-settings (DATABASE_URL async, EVOLUTION_BASE_URL, AI_PROVIDER, OLLAMA_*, ANTHROPIC_*, GEOCODING_*).
- `migrations/versions/202607020001_initial_schema.py` — migration inicial, já validada em modo offline (`alembic upgrade head --sql` e `alembic downgrade --sql` rodam limpo, sem duplicação de tipos ENUM, 7 tabelas criadas corretamente).
- `requirements.txt`, `.env.example`, `alembic.ini`.

Tudo isso foi verificado (import funciona, DDL compila corretamente contra dialect postgresql, alembic --sql roda sem erro) mas **nunca foi executado contra um Postgres real** — isso é algo que você, rodando localmente com Docker, deve fazer antes de seguir: suba o Postgres, rode `alembic upgrade head` de verdade, confirme.

## Estrutura de pastas completa já validada com o usuário (planejada, parte ainda não implementada)

```
lastmile-engine/
├── app/
│   ├── main.py                       # FALTA
│   ├── core/{config.py(pronto), logging.py(falta), security.py(falta)}
│   ├── db/ (pronto, ver acima)
│   ├── migrations/ (pronto)
│   ├── schemas/                      # FALTA: occurrence.py, ai_outputs.py, evolution_webhook.py
│   ├── ai/                           # FALTA: base.py, factory.py, providers/{ollama,anthropic}, prompts/
│   ├── state_machine/                # FALTA: states.py, engine.py, transitions/*
│   ├── integrations/evolution_api/   # FALTA: client.py, webhook_parser.py
│   ├── geo/                          # FALTA: geocoding.py, distance.py
│   ├── services/                     # FALTA: occurrence_service.py, idempotency_service.py, human_queue_service.py
│   ├── api/v1/                       # FALTA: webhooks.py, occurrences.py, health.py
│   └── workers/                      # FALTA: timeout_checker.py (provavelmente APScheduler embutido no processo, evitando subir Celery+Redis — confirmar com usuário se preferir diferente)
├── tests/                            # FALTA
├── Dockerfile                        # FALTA
└── docker-compose.yml                # FALTA — deve rodar como serviço adicional ao lado do docker-compose do whatsapp-saas, reaproveitando o container evolution-go; usar database própria (schema/db isolado) no mesmo Postgres ou Postgres próprio — decidir e confirmar com o usuário qual abordagem preferem antes de implementar.
```

## Próximo passo imediato

Implementar o item 2 da lista acima: scaffold completo do FastAPI (main.py, schemas, camada de IA abstrata com providers Ollama/Anthropic, motor de máquina de estados, integração evolution-go, geocoding/haversine, services, endpoints, workers de timeout) e então o Dockerfile/docker-compose. Construa por partes, valide com o usuário entre etapas grandes (ele prefere isso), e valide tecnicamente cada etapa antes de entregar (rodar testes, subir os containers, testar o webhook com payload de exemplo) — não entregue código não testado como se estivesse pronto.

O usuário prefere respostas concisas e diretas — evite explicações longas desnecessárias.

## Status (atualizado 2026-07-02): scaffold completo, validado ponta a ponta

Tudo que estava "FALTA" na árvore acima foi implementado e testado contra infraestrutura real (Postgres do stack whatsapp-saas com DB `lastmile_engine` isolado, Ollama local `qwen3:8b`, geocoding Nominatim real, container Docker rodando). Ver `app/`, `tests/` (31 testes passando), `Dockerfile`, `docker-compose.yml`.

Bug real encontrado e corrigido nos models "prontos": `PGEnum(...)` sem `values_callable` fazia o SQLAlchemy usar `.name` (maiúsculo) em vez de `.value` (minúsculo) do enum Python, quebrando toda leitura/escrita real contra o tipo ENUM do Postgres — só não aparecia no `alembic --sql` offline. Corrigido em `occurrence.py`, `state_transition.py`, `message_log.py`, `ai_decision_log.py`.

Decisões tomadas com o usuário durante a implementação (não revisitar sem novo pedido):
- Payload de áudio/botão do evolution-go: sem confirmação real, segue o formato padrão da lib whatsmeow (`audioMessage`, `buttonsResponseMessage`, `Info.ID`) — assumido e isolado em `app/schemas/evolution_webhook.py` e `app/integrations/evolution_api/webhook_parser.py`. Corrigir ali se um payload real divergir.
- `Occurrence.original_address` é preenchido pelo operador na fila humana (`HumanQueueFillRequest.original_address`, obrigatório), não pelo motorista — é o ponto de origem pro cálculo de raio.
- Docker: reaproveita a rede `whatsapp-saas_default` (external) e o mesmo Postgres físico do stack `whatsapp-saas`, com DB (`lastmile_engine`) e usuário (`lastmile`) isolados. Ollama roda nativo no host neste ambiente (não containerizado) — acessado via `host.docker.internal:11434` (só nas envs do container; `.env` local usa `localhost`, `docker-compose.yml` sobrescreve via `environment:`).
- Timeout do provider Ollama: 120s (modelos "thinking" locais podem passar de 60s em hardware modesto).

Gaps conhecidos, não implementados (fora do escopo pedido até agora):
- Transcrição de áudio (STT): não há provider configurado. Mensagem de áudio sem transcrição escala direto pra humano (comportamento seguro, não inventa pipeline de ASR).
- Não há endpoint/fluxo pra um humano *resolver* uma ocorrência em `escalated_to_human` — hoje é estado terminal pro motor automático.
- Sem endpoint de gestão de tenants (criação/edição é manual via SQL por enquanto).

## Teste com WhatsApp real (2026-07-02)

Testado de ponta a ponta com uma instância evolution-go real pareada via QR (separada da instância do whatsapp-saas, nome `lastmile-teste`) — webhook → parser → IA (Ollama) → motor de estados → Postgres, tudo confirmado funcionando com tráfego real.

Achados corrigidos, com evidência no código-fonte Go do fork (`C:\whatsapp-saas\evolution-go`, se ainda existir localmente):
- `ButtonsResponseMessage.selectedButtonID` (ID maiúsculo — protobuf `WAWebProtobufsE2E.pb.go:5734`), não `selectedButtonId`.
- `AudioMessage.URL` e `.PTT` (maiúsculos — exceção ao padrão lowerCamelCase do resto do protobuf, `WAWebProtobufsE2E.pb.go:15355,15360`).
- `Info.Sender` às vezes vem em formato LID (`"239414395584641@lid"`) em vez de JID com telefone real (`"...@s.whatsapp.net"`) — evolution-go às vezes não resolve o swap LID→telefone a tempo do webhook. `webhook_parser.py` agora ignora (retorna None) qualquer Sender que não termine em `@s.whatsapp.net`, em vez de gravar um LID como telefone.
- Clique de botão dispara um evento **separado** `"ButtonClick"` (estrutura totalmente diferente, `data.buttonId`/`data.phone`/etc.) além do `"Message"` normal — e esse evento aparenta ter um bug no próprio fork (`dataMap["Sender"]`/`dataMap["FromMe"]` não existem no nível em que são lidos, phone/jid provavelmente vêm nulos). O parser ignora `"ButtonClick"` de propósito; botão é tratado via `data.Message.buttonsResponseMessage` no evento `"Message"`, que é confiável.

Achado não corrigido (comportamento esperado, não bug): qualquer mensagem que chegar no número pareado é tratada como relato de motorista (não há como o motor distinguir "conversa pessoal" de "relato" a priori) — em produção o número precisa ser dedicado, nunca um WhatsApp pessoal. Na prática isso gerou várias ocorrências `escalated_to_human` durante o teste (mensagens sem relação com entrega, corretamente escaladas por ambiguidade em vez de mal-classificadas).
