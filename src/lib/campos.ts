// Lista branca dos campos editáveis por entidade, usada para validar o salvamento automático.
import { ORIGEM, SISTEMA, SITUACAO_DOC, SITUACAO_ITEM, STATUS, TIPO_PECA, INFORMACAO } from "./dominio";

export type TipoCampo =
  | { t: "texto"; obrigatorio?: boolean }
  | { t: "decimal"; obrigatorio?: boolean; min?: number; max?: number }
  | { t: "inteiro" }
  | { t: "data" }
  | { t: "bool" }
  | { t: "enum"; valores: readonly string[]; obrigatorio?: boolean };

const texto: TipoCampo = { t: "texto" };
const dinheiro: TipoCampo = { t: "decimal", min: 0 };
const pct: TipoCampo = { t: "decimal", min: 0, max: 100 };
const data: TipoCampo = { t: "data" };
const en = (o: object, obrigatorio = false): TipoCampo => ({ t: "enum", valores: Object.keys(o), obrigatorio });

export const CAMPOS = {
  lote: {
    nome: { t: "texto", obrigatorio: true },
    leiloeiro: texto,
    numeroLote: texto,
    link: texto,
    marca: texto,
    modelo: texto,
    versao: texto,
    ano: { t: "inteiro" },
    motorCambio: texto,
    km: { t: "inteiro" },
    origem: en(ORIGEM),
    tipoDano: texto,
    condicaoEdital: texto,
    lanceAtual: dinheiro,
    dataLeilao: data,
    cidadePatio: texto,
    observacoes: texto,
    status: en(STATUS, true),
    motivoDescarte: texto,
    valorPerdido: dinheiro,
    docSituacao: en(SITUACAO_DOC, true),
    docNotas: texto,
    fipe: dinheiro,
    vendaProvavel: dinheiro,
    vendaRapida: dinheiro,
    notasVenda: texto,
    lucroMinimo: dinheiro,
    comissaoPct: pct,
    taxasLeilao: dinheiro,
    transporte: dinheiro,
    documentacao: dinheiro,
    custosVenda: dinheiro,
    custoCapital: dinheiro,
    tributos: dinheiro,
    lanceArrematado: dinheiro,
    dataArremate: data,
    taxasReais: dinheiro,
    transporteReal: dinheiro,
    documentacaoReal: dinheiro,
    outrosGastos: dinheiro,
    precoVenda: dinheiro,
    dataVenda: data,
    custosVendaReais: dinheiro,
  },
  item: {
    sistema: en(SISTEMA, true),
    descricao: { t: "texto", obrigatorio: true },
    situacao: en(SITUACAO_ITEM, true),
    informacao: en(INFORMACAO, true),
    quantidade: { t: "decimal", obrigatorio: true, min: 0 },
    precoOriginal: dinheiro,
    precoParalela: dinheiro,
    precoUsada: dinheiro,
    tipoProvavel: en(TIPO_PECA),
    horasMO: { t: "decimal", min: 0 },
    agregados: dinheiro,
    fontePreco: texto,
    validado: { t: "bool" },
    custoReal: dinheiro,
  },
  risco: {
    nome: { t: "texto", obrigatorio: true },
    chancePct: pct,
    custo: dinheiro,
  },
  parametros: {
    horaOficina: { t: "decimal", obrigatorio: true, min: 0 },
    lucroMinimo: { t: "decimal", obrigatorio: true, min: 0 },
    comissaoPct: { t: "decimal", obrigatorio: true, min: 0, max: 100 },
    taxasLeilao: { t: "decimal", obrigatorio: true, min: 0 },
    transporte: { t: "decimal", obrigatorio: true, min: 0 },
    documentacao: { t: "decimal", obrigatorio: true, min: 0 },
    custosVenda: { t: "decimal", obrigatorio: true, min: 0 },
    custoCapital: { t: "decimal", obrigatorio: true, min: 0 },
    tributos: { t: "decimal", obrigatorio: true, min: 0 },
  },
  kit: { nome: { t: "texto", obrigatorio: true } },
  kitItem: {
    sistema: en(SISTEMA, true),
    descricao: { t: "texto", obrigatorio: true },
    quantidade: { t: "decimal", obrigatorio: true, min: 0 },
  },
} satisfies Record<string, Record<string, TipoCampo>>;

export type Entidade = keyof typeof CAMPOS;

/** Valor vindo do cliente (string canônica, boolean ou null) → valor pronto para o Prisma. Lança erro se inválido. */
export function converterValor(tipo: TipoCampo, valor: unknown): unknown {
  const vazio = valor === null || valor === undefined || valor === "";
  if (tipo.t === "bool") {
    if (typeof valor !== "boolean") throw new Error("Valor inválido");
    return valor;
  }
  if (vazio) {
    if ("obrigatorio" in tipo && tipo.obrigatorio) throw new Error("Campo obrigatório");
    return null;
  }
  const s = String(valor).trim();
  switch (tipo.t) {
    case "texto":
      return s.slice(0, 5000);
    case "decimal": {
      if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error("Número inválido");
      const n = Number(s);
      if (tipo.min !== undefined && n < tipo.min) throw new Error(`Mínimo ${tipo.min}`);
      if (tipo.max !== undefined && n > tipo.max) throw new Error(`Máximo ${tipo.max}`);
      return s;
    }
    case "inteiro": {
      if (!/^\d+$/.test(s)) throw new Error("Número inteiro inválido");
      return Number(s);
    }
    case "data": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Data inválida");
      return new Date(`${s}T00:00:00Z`);
    }
    case "enum":
      if (!tipo.valores.includes(s)) throw new Error("Opção inválida");
      return s;
  }
}
