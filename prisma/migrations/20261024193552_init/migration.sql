-- CreateEnum
CREATE TYPE "StatusLote" AS ENUM ('triagem', 'avaliando', 'dar_lance', 'descartado', 'perdido', 'arrematado', 'vendido');

-- CreateEnum
CREATE TYPE "Origem" AS ENUM ('seguradora', 'financeira', 'locadora', 'orgao_publico', 'outro');

-- CreateEnum
CREATE TYPE "SituacaoDoc" AS ENUM ('pendente', 'verificada', 'bloqueada');

-- CreateEnum
CREATE TYPE "Sistema" AS ENUM ('motor', 'arrefecimento', 'eletrica', 'funilaria', 'estrutura', 'suspensao_direcao', 'transmissao', 'interior', 'seguranca', 'outros');

-- CreateEnum
CREATE TYPE "SituacaoItem" AS ENUM ('ausente', 'danificado', 'reparar', 'inspecionar', 'ok');

-- CreateEnum
CREATE TYPE "Informacao" AS ENUM ('observado', 'inferido');

-- CreateEnum
CREATE TYPE "TipoPeca" AS ENUM ('original', 'paralela', 'usada');

-- CreateTable
CREATE TABLE "Parametros" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "horaOficina" DECIMAL(12,2) NOT NULL DEFAULT 150,
    "lucroMinimo" DECIMAL(12,2) NOT NULL DEFAULT 15000,
    "comissaoPct" DECIMAL(6,2) NOT NULL DEFAULT 5,
    "taxasLeilao" DECIMAL(12,2) NOT NULL DEFAULT 2000,
    "transporte" DECIMAL(12,2) NOT NULL DEFAULT 2500,
    "documentacao" DECIMAL(12,2) NOT NULL DEFAULT 1500,
    "custosVenda" DECIMAL(12,2) NOT NULL DEFAULT 2000,
    "custoCapital" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tributos" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Parametros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "leiloeiro" TEXT,
    "numeroLote" TEXT,
    "link" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "versao" TEXT,
    "ano" INTEGER,
    "motorCambio" TEXT,
    "km" INTEGER,
    "origem" "Origem",
    "tipoDano" TEXT,
    "condicaoEdital" TEXT,
    "lanceAtual" DECIMAL(12,2),
    "dataLeilao" DATE,
    "cidadePatio" TEXT,
    "observacoes" TEXT,
    "status" "StatusLote" NOT NULL DEFAULT 'triagem',
    "motivoDescarte" TEXT,
    "valorPerdido" DECIMAL(12,2),
    "docSituacao" "SituacaoDoc" NOT NULL DEFAULT 'pendente',
    "docNotas" TEXT,
    "fipe" DECIMAL(12,2),
    "vendaProvavel" DECIMAL(12,2),
    "vendaRapida" DECIMAL(12,2),
    "notasVenda" TEXT,
    "lucroMinimo" DECIMAL(12,2),
    "comissaoPct" DECIMAL(6,2),
    "taxasLeilao" DECIMAL(12,2),
    "transporte" DECIMAL(12,2),
    "documentacao" DECIMAL(12,2),
    "custosVenda" DECIMAL(12,2),
    "custoCapital" DECIMAL(12,2),
    "tributos" DECIMAL(12,2),
    "lanceArrematado" DECIMAL(12,2),
    "dataArremate" DATE,
    "taxasReais" DECIMAL(12,2),
    "transporteReal" DECIMAL(12,2),
    "documentacaoReal" DECIMAL(12,2),
    "outrosGastos" DECIMAL(12,2),
    "precoVenda" DECIMAL(12,2),
    "dataVenda" DATE,
    "custosVendaReais" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemReparo" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "sistema" "Sistema" NOT NULL DEFAULT 'outros',
    "descricao" TEXT NOT NULL,
    "situacao" "SituacaoItem" NOT NULL DEFAULT 'inspecionar',
    "informacao" "Informacao" NOT NULL DEFAULT 'observado',
    "quantidade" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "precoOriginal" DECIMAL(12,2),
    "precoParalela" DECIMAL(12,2),
    "precoUsada" DECIMAL(12,2),
    "tipoProvavel" "TipoPeca",
    "horasMO" DECIMAL(8,2),
    "agregados" DECIMAL(12,2),
    "fontePreco" TEXT,
    "validado" BOOLEAN NOT NULL DEFAULT false,
    "custoReal" DECIMAL(12,2),

    CONSTRAINT "ItemReparo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risco" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "nome" TEXT NOT NULL,
    "chancePct" DECIMAL(6,2),
    "custo" DECIMAL(12,2),

    CONSTRAINT "Risco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cotacao" (
    "id" TEXT NOT NULL,
    "peca" TEXT NOT NULL,
    "modelo" TEXT,
    "tipo" "TipoPeca" NOT NULL,
    "preco" DECIMAL(12,2) NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "link" TEXT,
    "data" DATE NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitDano" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KitDano_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitDanoItem" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "sistema" "Sistema" NOT NULL DEFAULT 'outros',
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(8,2) NOT NULL DEFAULT 1,

    CONSTRAINT "KitDanoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemReparo_loteId_idx" ON "ItemReparo"("loteId");

-- CreateIndex
CREATE INDEX "Risco_loteId_idx" ON "Risco"("loteId");

-- CreateIndex
CREATE INDEX "Cotacao_peca_modelo_tipo_idx" ON "Cotacao"("peca", "modelo", "tipo");

-- AddForeignKey
ALTER TABLE "ItemReparo" ADD CONSTRAINT "ItemReparo_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risco" ADD CONSTRAINT "Risco_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitDanoItem" ADD CONSTRAINT "KitDanoItem_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "KitDano"("id") ON DELETE CASCADE ON UPDATE CASCADE;
