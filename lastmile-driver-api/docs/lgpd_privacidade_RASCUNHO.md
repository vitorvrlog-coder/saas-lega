# Política de Privacidade / Aviso de Privacidade — Heimdall Logtech

> **RASCUNHO — NÃO PUBLICAR SEM REVISÃO DE ADVOGADO.** Este documento foi
> gerado como ponto de partida técnico, mapeando os dados reais que o sistema
> coleta e processa (com base no código-fonte). Não é aconselhamento
> jurídico. Antes de publicar, um advogado especializado em LGPD precisa
> revisar especialmente: (1) a base legal escolhida pra cada tratamento,
> (2) o papel de Heimdall como Operador vs. as transportadoras como
> Controladoras, (3) prazos de retenção definitivos, (4) se há transferência
> internacional de dados (ver seção 6) e sua base legal.

---

## 0. Contexto — quem processa o quê (mapeado do código, não é texto final)

O Heimdall Logtech é usado por **transportadoras** (tenants) pra tratar
insucessos de entrega. Nesse fluxo, circulam dados pessoais de **duas
categorias de titulares que não são usuários do sistema**:

- **Motoristas**: nome, telefone, placa/tipo de veículo (`app/db/models/driver.py`).
- **Clientes finais** (quem recebeu ou deveria receber a entrega): nome,
  telefone, endereço, novo endereço proposto em caso de reagendamento
  (`app/db/models/occurrence.py`).

E uma terceira categoria que **são** usuários diretos do sistema:

- **Operadores/admins do dashboard**: e-mail, senha (hash), e agora (sessão
  atual) nome e telefone opcionais (`app/db/models/user.py`).

Todo o conteúdo de conversa de WhatsApp (mensagens, mídia) é armazenado em
`message_logs`, e as decisões automatizadas de IA (classificação de motivo,
de resposta do cliente) em `ai_decision_logs` — incluindo o payload bruto
enviado/recebido da IA.

**Ponto que precisa de decisão jurídica, não técnica**: a transportadora
(tenant) é quem tem a relação direta com motorista e cliente final — ela é
provavelmente a **Controladora** desses dados (art. 5º, VI da LGPD), e a
Heimdall atua como **Operadora** (art. 5º, VII), processando por conta e
ordem da transportadora. Isso normalmente exige um **contrato/adendo de
tratamento de dados (DPA)** entre Heimdall e cada tenant, definindo
finalidade, prazo de retenção e responsabilidades — documento separado
deste, ainda não redigido.

---

## 1. Dados coletados

### 1.1. De motoristas e clientes finais (via WhatsApp)
- Nome, telefone.
- Endereço (original e, se houver reagendamento, o novo endereço proposto).
- Conteúdo das mensagens trocadas (texto, áudio transcrito, botões,
  imagens) — `message_logs.content_text`, `message_logs.raw_payload`.
- Geolocalização aproximada, quando o novo endereço é validado por raio de
  distância (`occurrences.distance_km`, `new_address_lat/lon`).

### 1.2. De operadores/admins do dashboard
- E-mail, senha (armazenada como hash, nunca em texto puro).
- Nome e telefone (opcionais, autoatendidos — feature adicionada nesta sessão).
- Papel/permissão (admin de plataforma, admin principal, admin de tenant,
  operador comum).

### 1.3. Dados gerados por IA
- Classificação de motivo de insucesso, classificação de resposta do
  cliente, nível de confiança, se a resposta foi ambígua ou escalada pra
  humano (`ai_decision_logs`).

---

## 2. Finalidade do tratamento

- Viabilizar o contato automatizado com motorista e cliente final pra
  resolver insucessos de entrega (reagendar, confirmar novo endereço,
  registrar insucesso definitivo).
- Treinar/calibrar a classificação automática (uso interno, não
  compartilhado entre tenants — dados são isolados por tenant_id).
- Métricas operacionais pro backoffice da Heimdall (volume de mensagens,
  taxa de resolução) — agregadas, não expostas fora da equipe Heimdall e do
  próprio tenant.

---

## 3. Base legal (a confirmar com advogado)

Candidatos prováveis, mas a escolha final e a documentação de cada uma é
trabalho jurídico:
- **Execução de contrato** (art. 7º, V) — entre a transportadora e o
  destinatário da entrega, pro tratamento do endereço/telefone estritamente
  necessário à entrega.
- **Legítimo interesse** (art. 7º, IX) — pra parte da automação
  operacional, com necessidade de teste de proporcionalidade documentado.
- Para motoristas, se forem prestadores/funcionários da transportadora,
  pode se aplicar base distinta (execução de contrato de trabalho/prestação
  de serviço) — depende do vínculo, que a Heimdall não controla.

---

## 4. Retenção e exclusão

**Hoje o sistema não implementa expurgo automático** — occurrences,
message_logs e ai_decision_logs ficam retidos indefinidamente (confirmado
lendo o código: não há job de limpeza por idade). Isso é um risco de
compliance real, não só de política escrita: a LGPD exige que o dado não
seja mantido além do necessário pra finalidade (art. 15). Recomendação
técnica: definir um prazo (ex: 24 meses após fechamento da ocorrência) e
implementar expurgo automatizado antes de publicar qualquer prazo de
retenção neste documento.

---

## 5. Direitos do titular

Motoristas e clientes finais podem solicitar, via canal a definir (e-mail
de contato da transportadora ou da Heimdall — decidir qual):
- Confirmação de existência de tratamento e acesso aos dados (art. 18, I e II).
- Correção de dados incompletos/desatualizados (art. 18, III).
- Eliminação de dados tratados com consentimento, quando aplicável (art. 18, VI).
- Informação sobre compartilhamento (art. 18, VII).

**Gap técnico atual**: não existe rota/processo no sistema pra atender
esses pedidos (ex: buscar todas as ocorrências ligadas a um telefone e
exportar/excluir). Antes de publicar esse direito por escrito, vale existir
o processo — mesmo que manual (consulta direta no banco por um operador
autorizado) — pra não prometer algo que não dá pra cumprir no prazo legal
(15 dias, art. 19).

---

## 6. Transferência internacional de dados

**Ponto crítico a confirmar**: o provedor de IA é plugável
(`app/services/ai_provider` — Ollama local ou Anthropic). Se o tenant usa
Anthropic (API nos EUA), o conteúdo da mensagem do motorista/cliente sai do
Brasil para classificação. Isso é transferência internacional de dados
pessoais (art. 33) e precisa de base legal específica (cláusulas
contratuais padrão, ou consentimento específico, dependendo do caso) — não
coberta ainda neste rascunho. Se o tenant usa só Ollama local, o dado não
sai do servidor da Heimdall — vale documentar essa diferença por tenant.

---

## 7. Segurança

- Senhas de usuários do dashboard: hash bcrypt, nunca texto puro
  (`app/core/security.py`).
- Isolamento por tenant: toda consulta de dados operacionais é escopada por
  `tenant_id` (`app/web/deps.py:scope_to_tenant`).
- **Gap**: não há log de auditoria de quem acessou/exportou dados de um
  titular específico — recomendado como melhoria técnica separada (ver
  sugestão de log de auditoria do admin principal, já levantada nesta
  sessão).

---

## 8. Contato do encarregado (DPO)

A definir — LGPD exige um canal de contato do encarregado de dados (art.
41). Placeholder: `privacidade@heimdall.com` (confirmar se esse e-mail
existe/será criado).

---

## Resumo do que falta pra isso virar documento publicável

1. Advogado define a base legal de cada tratamento (seção 3).
2. Decisão de negócio + jurídica sobre o papel Controlador/Operador entre
   Heimdall e cada transportadora, formalizada em contrato (seção 0).
3. Implementar expurgo por prazo de retenção antes de prometer um prazo
   (seção 4).
4. Implementar processo (mesmo manual) de atendimento a pedidos de
   titular antes de publicar esse direito (seção 5).
5. Confirmar, por tenant, se há transferência internacional (seção 6) e
   documentar a base legal correspondente.
6. Confirmar/criar o canal de contato do encarregado (seção 8).
