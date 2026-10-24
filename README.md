# Avaliador de Leilão

Sistema pessoal para avaliar carros de leilão antes do lance: peças e reparos, riscos, custos, **lance máximo** com a conta detalhada e, depois da compra, **previsto × real**.

Stack: Next.js 15 (App Router) + TypeScript + Tailwind 4 + Prisma 6 + PostgreSQL. Valores em `NUMERIC` no banco e `decimal.js` nos cálculos (nunca `float`).

## Rodar localmente

Pré-requisitos: Node 20+ e um PostgreSQL (local, Docker ou o próprio Supabase).

```bash
# 1. Banco local com Docker (opcional — pode usar a URL do Supabase direto)
docker run -d --name leilao-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=leilao -p 5432:5432 postgres:16

# 2. Variáveis de ambiente
cp .env.example .env        # ajuste APP_PASSWORD e AUTH_SECRET

# 3. Dependências, tabelas e dados iniciais
npm install
npx prisma migrate deploy   # cria as tabelas
npm run db:seed             # parâmetros padrão, 5 kits de dano e o lote da Hilux

# 4. Subir
npm run dev                 # http://localhost:3000 (no celular: http://IP-do-PC:3000)
```

| Comando | O que faz |
| --- | --- |
| `npm test` | testes unitários do motor de cálculo (Vitest) |
| `npm run lint` | checagem de tipos (TypeScript) |
| `npm run build` | build de produção |
| `npm run db:migrate` | cria nova migration após mudar `prisma/schema.prisma` (desenvolvimento) |

O seed é idempotente: não duplica kits nem o lote de exemplo se rodar de novo.

## Variáveis de ambiente

| Nome | Descrição |
| --- | --- |
| `DATABASE_URL` | conexão usada pelo app (no Supabase: pooler, porta 6543, com `?pgbouncer=true`) |
| `DIRECT_URL` | conexão direta usada pelas migrations (no Supabase: porta 5432) |
| `APP_PASSWORD` | senha única de acesso |
| `AUTH_SECRET` | segredo para assinar o cookie de sessão — gere com `openssl rand -hex 32` |

Trocar `AUTH_SECRET` derruba todas as sessões abertas.

## Publicar (Vercel + Supabase)

1. **Supabase** → New project. Em *Connect → ORMs → Prisma* copie as duas URLs:
   - `DATABASE_URL` = `postgresql://postgres.[ref]:[senha]@aws-0-[região].pooler.supabase.com:6543/postgres?pgbouncer=true`
   - `DIRECT_URL` = `postgresql://postgres.[ref]:[senha]@aws-0-[região].pooler.supabase.com:5432/postgres`
2. **Criar as tabelas no Supabase** (do seu computador, com essas URLs no `.env`):
   ```bash
   npx prisma migrate deploy
   npm run db:seed
   ```
3. **Vercel** → Add New Project → importe este repositório. Em *Environment Variables* cadastre `DATABASE_URL`, `DIRECT_URL`, `APP_PASSWORD` e `AUTH_SECRET`. O comando de build padrão (`npm run build`) já roda `prisma generate`.
4. Deploy. A cada mudança futura no schema: `npm run db:migrate` localmente, commit da migration e `npx prisma migrate deploy` apontando para o Supabase antes (ou junto) do deploy.

As páginas estáticas `terms.html`, `privacy.html` e `delete-data.html` (em `public/`) continuam públicas; todo o resto exige login.

## Como o sistema funciona

### Telas
- **Painel** — indicadores (em avaliação, para dar lance com soma dos tetos, capital em arrematados, desvio reparo real × previsto, lucro realizado) e tabela de todos os lotes.
- **Lotes** — cards; **Novo lote** cria e abre o detalhe.
- **Detalhe do lote** — tudo salva sozinho (indicador “Salvando… / ✓ Salvo” no topo). O resultado é recalculado no navegador a cada digitação.
- **Peças** — cotações. Cada cotação é um registro novo com data, fornecedor e tipo; não existe edição (apagar só para corrigir digitação). O menor preço por peça + modelo + tipo fica destacado.
- **Parâmetros** — valores padrão usados quando o campo do lote está vazio. Zero digitado no lote vale como zero.
- **Kits** — kits de dano editáveis (ficam no banco).

### Regras de cálculo (`src/lib/calc/motor.ts`)
Por item com situação ≠ OK (preços considerados só se > 0):
- econômico = menor preço · provável = tipo escolhido → paralela → original → usada · conservador = original, senão o maior
- mão de obra = horas × hora de oficina; preços × quantidade (horas e agregados são do item)
- itens **inspecionar** entram só no conservador

Reparo, riscos e lances:
- `reparo_econômico/provável` = peças + MO + agregados (sem inspecionar); `reparo_conservador` inclui os itens a inspecionar
- `risco_esperado` = Σ chance × custo; `risco_conservador` usa custo cheio quando chance ≥ 25%
- `lance econômico` = (venda provável − reparo provável − risco esperado − custos fixos − lucro mínimo) ÷ (1 + comissão)
- `lance ajustado` = (mín(venda provável, venda rápida) − reparo conservador − risco conservador − custos fixos − lucro mínimo) ÷ (1 + comissão)
- **teto autorizado** = lance ajustado (mínimo 0), só sem bloqueios: documentação ≠ verificada, falta venda provável, item ausente/danificado sem preço
- alertas (não bloqueiam): preços não validados, itens a inspecionar, riscos sem custo, venda rápida vazia

Veredito, em ordem: status (descartado/perdido/arrematado/vendido) → sem preço de venda → não vale (os dois lances ≤ 0) → bloqueado → não vale no cenário de risco (ajustado ≤ 0) → “até R$ X” (sem lance atual) → dentro/acima do limite.

Pós-compra (`src/lib/calc/posCompra.ts`): custo real = lance × (1 + c) + taxas + transporte + documentação reais + Σ custo real dos itens + outros; lucro real = venda − custos de venda reais − custo real. O custo real de cada item é o total gasto nele (peça + MO + agregados) e fica em coluna separada: o previsto nunca é sobrescrito.

## Estrutura

```
prisma/              schema, migrations, seed
public/              páginas estáticas públicas
src/app/login        login
src/app/(app)/       Painel, lotes, lotes/[id], pecas, parametros, kits
src/components/      campos com salvamento automático, UI
src/lib/calc/        motor de cálculo puro + testes
src/lib/actions/     server actions (todas exigem sessão)
src/lib/campos.ts    lista branca dos campos editáveis e validação
```
