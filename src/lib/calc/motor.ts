// Motor de cálculo do lance máximo. Funções puras: sem banco, sem data/hora, sem efeitos colaterais.
import Decimal from "decimal.js";
import type { ItemDTO, LoteDTO, ParametrosDTO, RiscoDTO, TipoPeca } from "../dominio";

type D = string | null | undefined;

const ZERO = new Decimal(0);
const CEM = new Decimal(100);

/** Valor opcional → Decimal (vazio/inválido = 0). */
export function dec(v: D): Decimal {
  if (v === null || v === undefined || v === "") return ZERO;
  const d = new Decimal(v);
  return d.isFinite() ? d : ZERO;
}

function temValor(v: D): boolean {
  return v !== null && v !== undefined && v !== "";
}

const positivo = (v: D): Decimal | null => (temValor(v) && dec(v).gt(0) ? dec(v) : null);

const soma = (xs: Decimal[]) => xs.reduce((a, b) => a.plus(b), ZERO);

// ───────────────────────────── Itens ─────────────────────────────

export type ItemEntrada = Pick<
  ItemDTO,
  | "descricao"
  | "situacao"
  | "quantidade"
  | "precoOriginal"
  | "precoParalela"
  | "precoUsada"
  | "tipoProvavel"
  | "horasMO"
  | "agregados"
  | "validado"
>;

export type ItemCalculado = {
  /** Item entra em algum cenário (situação ≠ OK). */
  conta: boolean;
  inspecionar: boolean;
  /** Nenhum preço > 0 informado. */
  semPreco: boolean;
  /** Preços unitários escolhidos em cada cenário (null = sem preço). */
  unitEconomico: Decimal | null;
  unitProvavel: Decimal | null;
  unitConservador: Decimal | null;
  tipoUsadoProvavel: TipoPeca | null;
  /** Já multiplicados pela quantidade. */
  pecasEconomico: Decimal;
  pecasProvavel: Decimal;
  pecasConservador: Decimal;
  maoDeObra: Decimal;
  agregados: Decimal;
  totalEconomico: Decimal;
  totalProvavel: Decimal;
  totalConservador: Decimal;
};

export function calcularItem(item: ItemEntrada, horaOficina: D): ItemCalculado {
  const precos: Record<TipoPeca, Decimal | null> = {
    original: positivo(item.precoOriginal),
    paralela: positivo(item.precoParalela),
    usada: positivo(item.precoUsada),
  };
  const disponiveis = Object.values(precos).filter((p): p is Decimal => p !== null);

  const unitEconomico = disponiveis.length ? Decimal.min(...disponiveis) : null;

  let tipoUsadoProvavel: TipoPeca | null = null;
  const ordem: TipoPeca[] = [
    ...(item.tipoProvavel ? [item.tipoProvavel] : []),
    "paralela",
    "original",
    "usada",
  ];
  for (const t of ordem) {
    if (precos[t]) {
      tipoUsadoProvavel = t;
      break;
    }
  }
  const unitProvavel = tipoUsadoProvavel ? precos[tipoUsadoProvavel] : null;

  const unitConservador = precos.original ?? (disponiveis.length ? Decimal.max(...disponiveis) : null);

  const qtd = dec(item.quantidade);
  const pecasEconomico = (unitEconomico ?? ZERO).times(qtd);
  const pecasProvavel = (unitProvavel ?? ZERO).times(qtd);
  const pecasConservador = (unitConservador ?? ZERO).times(qtd);
  const maoDeObra = dec(item.horasMO).times(dec(horaOficina));
  const agregados = dec(item.agregados);

  return {
    conta: item.situacao !== "ok",
    inspecionar: item.situacao === "inspecionar",
    semPreco: disponiveis.length === 0,
    unitEconomico,
    unitProvavel,
    unitConservador,
    tipoUsadoProvavel,
    pecasEconomico,
    pecasProvavel,
    pecasConservador,
    maoDeObra,
    agregados,
    totalEconomico: pecasEconomico.plus(maoDeObra).plus(agregados),
    totalProvavel: pecasProvavel.plus(maoDeObra).plus(agregados),
    totalConservador: pecasConservador.plus(maoDeObra).plus(agregados),
  };
}

export type Reparo = {
  economico: Decimal;
  provavel: Decimal;
  conservador: Decimal;
  /** Detalhamento para a conta exibida. */
  pecasEconomico: Decimal;
  pecasProvavel: Decimal;
  pecasConservador: Decimal;
  maoDeObra: Decimal;
  agregados: Decimal;
  inspecionarConservador: Decimal;
};

export function calcularReparo(itens: ItemEntrada[], horaOficina: D): Reparo {
  const calc = itens.map((i) => calcularItem(i, horaOficina)).filter((c) => c.conta);
  const firmes = calc.filter((c) => !c.inspecionar);
  const inspecionar = calc.filter((c) => c.inspecionar);

  const pecasEconomico = soma(firmes.map((c) => c.pecasEconomico));
  const pecasProvavel = soma(firmes.map((c) => c.pecasProvavel));
  const pecasConservador = soma(firmes.map((c) => c.pecasConservador));
  const maoDeObra = soma(firmes.map((c) => c.maoDeObra));
  const agregados = soma(firmes.map((c) => c.agregados));
  const inspecionarConservador = soma(inspecionar.map((c) => c.totalConservador));
  const base = maoDeObra.plus(agregados);

  return {
    economico: pecasEconomico.plus(base),
    provavel: pecasProvavel.plus(base),
    conservador: pecasConservador.plus(inspecionarConservador).plus(base),
    pecasEconomico,
    pecasProvavel,
    pecasConservador,
    maoDeObra,
    agregados,
    inspecionarConservador,
  };
}

// ───────────────────────────── Riscos ─────────────────────────────

export type RiscoEntrada = Pick<RiscoDTO, "nome" | "chancePct" | "custo">;

export function valorEsperadoRisco(r: RiscoEntrada): Decimal {
  return dec(r.chancePct).div(CEM).times(dec(r.custo));
}

export function valorConservadorRisco(r: RiscoEntrada): Decimal {
  return dec(r.chancePct).gte(25) ? dec(r.custo) : valorEsperadoRisco(r);
}

export function calcularRiscos(riscos: RiscoEntrada[]) {
  return {
    esperado: soma(riscos.map(valorEsperadoRisco)),
    conservador: soma(riscos.map(valorConservadorRisco)),
  };
}

// ───────────────────────────── Custos ─────────────────────────────

export type LoteEntrada = Pick<
  LoteDTO,
  | "status"
  | "docSituacao"
  | "docNotas"
  | "lanceAtual"
  | "vendaProvavel"
  | "vendaRapida"
  | "lucroMinimo"
  | "comissaoPct"
  | "taxasLeilao"
  | "transporte"
  | "documentacao"
  | "custosVenda"
  | "custoCapital"
  | "tributos"
>;

export type CampoCusto =
  | "lucroMinimo"
  | "comissaoPct"
  | "taxasLeilao"
  | "transporte"
  | "documentacao"
  | "custosVenda"
  | "custoCapital"
  | "tributos";

export type Custos = Record<CampoCusto, Decimal> & {
  /** Campos em que o lote usa o padrão dos Parâmetros. */
  padrao: Set<CampoCusto>;
  fixos: Decimal;
  /** Comissão como fração (5% → 0,05). */
  c: Decimal;
};

const CAMPOS_CUSTO: CampoCusto[] = [
  "lucroMinimo",
  "comissaoPct",
  "taxasLeilao",
  "transporte",
  "documentacao",
  "custosVenda",
  "custoCapital",
  "tributos",
];

export function resolverCustos(lote: Partial<Pick<LoteDTO, CampoCusto>>, p: ParametrosDTO): Custos {
  const padrao = new Set<CampoCusto>();
  const v = {} as Record<CampoCusto, Decimal>;
  for (const k of CAMPOS_CUSTO) {
    if (temValor(lote[k])) v[k] = dec(lote[k]);
    else {
      v[k] = dec(p[k]);
      padrao.add(k);
    }
  }
  const fixos = soma([v.taxasLeilao, v.transporte, v.documentacao, v.custosVenda, v.custoCapital, v.tributos]);
  return { ...v, padrao, fixos, c: v.comissaoPct.div(CEM) };
}

// ───────────────────────────── Resultado ─────────────────────────────

export type Aviso = { codigo: string; mensagem: string };

export type TipoVeredito =
  | "descartado"
  | "vendido"
  | "arrematado"
  | "perdido"
  | "sem_venda"
  | "nao_vale"
  | "nao_vale_risco"
  | "bloqueado"
  | "ate"
  | "dentro"
  | "acima";

export type Veredito = { tipo: TipoVeredito; texto: string };

export type Resultado = {
  reparo: Reparo;
  riscos: { esperado: Decimal; conservador: Decimal };
  custos: Custos;
  vendaProvavel: Decimal | null;
  vendaRapida: Decimal | null;
  /** min(venda provável, venda rápida) — usado no lance ajustado. */
  vendaAjustada: Decimal | null;
  lanceEconomico: Decimal | null;
  lanceEconomicoPecasBaratas: Decimal | null;
  lanceAjustado: Decimal | null;
  /** Teto autorizado: só existe sem bloqueios (mínimo zero). */
  teto: Decimal | null;
  bloqueios: Aviso[];
  alertas: Aviso[];
  noLanceAtual: {
    lance: Decimal;
    custoLance: Decimal;
    lucro: Decimal | null;
    capital: Decimal;
    retorno: Decimal | null;
  } | null;
  veredito: Veredito;
};

export type EntradaCalculo = {
  lote: LoteEntrada;
  itens: ItemEntrada[];
  riscos: RiscoEntrada[];
  parametros: ParametrosDTO;
};

function lance(venda: Decimal, reparo: Decimal, risco: Decimal, custos: Custos): Decimal {
  return venda.minus(reparo).minus(risco).minus(custos.fixos).minus(custos.lucroMinimo).div(custos.c.plus(1));
}

const brl = (d: Decimal) =>
  d.toNumber().toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function calcularLote({ lote, itens, riscos, parametros }: EntradaCalculo): Resultado {
  const reparo = calcularReparo(itens, parametros.horaOficina);
  const r = calcularRiscos(riscos);
  const custos = resolverCustos(lote, parametros);

  const vendaProvavel = positivo(lote.vendaProvavel);
  const vendaRapida = positivo(lote.vendaRapida);
  const vendaAjustada = vendaProvavel ? (vendaRapida ? Decimal.min(vendaProvavel, vendaRapida) : vendaProvavel) : null;

  const lanceEconomico = vendaProvavel ? lance(vendaProvavel, reparo.provavel, r.esperado, custos) : null;
  const lanceEconomicoPecasBaratas = vendaProvavel ? lance(vendaProvavel, reparo.economico, r.esperado, custos) : null;
  const lanceAjustado = vendaAjustada ? lance(vendaAjustada, reparo.conservador, r.conservador, custos) : null;

  // Bloqueios
  const bloqueios: Aviso[] = [];
  if (lote.docSituacao === "bloqueada") {
    bloqueios.push({
      codigo: "doc_bloqueada",
      mensagem: `Documentação bloqueada${lote.docNotas ? `: ${lote.docNotas}` : " (motivo não informado)"}`,
    });
  } else if (lote.docSituacao !== "verificada") {
    bloqueios.push({
      codigo: "doc_pendente",
      mensagem: `Documentação não verificada${lote.docNotas ? `: ${lote.docNotas}` : ""}`,
    });
  }
  if (!vendaProvavel) bloqueios.push({ codigo: "sem_venda", mensagem: "Falta a venda provável" });
  const semPreco = itens.filter(
    (i) => (i.situacao === "ausente" || i.situacao === "danificado") && calcularItem(i, "0").semPreco,
  );
  if (semPreco.length) {
    bloqueios.push({
      codigo: "item_sem_preco",
      mensagem: `${semPreco.length} ${semPreco.length === 1 ? "item ausente/danificado sem preço" : "itens ausentes/danificados sem preço"}: ${semPreco.map((i) => i.descricao).join(", ")}`,
    });
  }

  // Alertas (não bloqueiam)
  const alertas: Aviso[] = [];
  const naoValidados = itens.filter((i) => i.situacao !== "ok" && !i.validado);
  if (naoValidados.length) {
    alertas.push({
      codigo: "nao_validado",
      mensagem: `${naoValidados.length} ${naoValidados.length === 1 ? "preço não validado" : "preços não validados"} em cotação real`,
    });
  }
  const aInspecionar = itens.filter((i) => i.situacao === "inspecionar");
  if (aInspecionar.length) {
    alertas.push({
      codigo: "inspecionar",
      mensagem: `${aInspecionar.length} ${aInspecionar.length === 1 ? "item a inspecionar" : "itens a inspecionar"} (só no cenário conservador): ${aInspecionar.map((i) => i.descricao).join(", ")}`,
    });
  }
  const riscosSemCusto = riscos.filter((x) => dec(x.chancePct).gt(0) && !dec(x.custo).gt(0));
  if (riscosSemCusto.length) {
    alertas.push({
      codigo: "risco_sem_custo",
      mensagem: `${riscosSemCusto.length === 1 ? "Risco sem custo informado (conta como zero)" : `${riscosSemCusto.length} riscos sem custo informado (contam como zero)`}: ${riscosSemCusto.map((x) => x.nome).join(", ")}`,
    });
  }
  if (vendaProvavel && !vendaRapida) {
    alertas.push({ codigo: "sem_venda_rapida", mensagem: "Venda rápida não informada: o lance ajustado usa a venda provável" });
  }

  const teto = bloqueios.length === 0 && lanceAjustado ? Decimal.max(lanceAjustado, 0) : null;

  // No lance atual
  const lanceAtual = temValor(lote.lanceAtual) ? dec(lote.lanceAtual) : null;
  let noLanceAtual: Resultado["noLanceAtual"] = null;
  if (lanceAtual) {
    const custoLance = lanceAtual.times(custos.c.plus(1));
    const capital = custoLance.plus(reparo.provavel).plus(custos.taxasLeilao).plus(custos.transporte).plus(custos.documentacao);
    const lucro = vendaProvavel
      ? vendaProvavel.minus(custoLance.plus(reparo.provavel).plus(r.esperado).plus(custos.fixos))
      : null;
    noLanceAtual = {
      lance: lanceAtual,
      custoLance,
      lucro,
      capital,
      retorno: lucro && capital.gt(0) ? lucro.div(capital) : null,
    };
  }

  const veredito = calcularVeredito({
    status: lote.status,
    vendaProvavel,
    lanceEconomico,
    lanceAjustado,
    bloqueado: bloqueios.length > 0,
    teto,
    lanceAtual,
  });

  return {
    reparo,
    riscos: r,
    custos,
    vendaProvavel,
    vendaRapida,
    vendaAjustada,
    lanceEconomico,
    lanceEconomicoPecasBaratas,
    lanceAjustado,
    teto,
    bloqueios,
    alertas,
    noLanceAtual,
    veredito,
  };
}

export function calcularVeredito(x: {
  status: LoteDTO["status"];
  vendaProvavel: Decimal | null;
  lanceEconomico: Decimal | null;
  lanceAjustado: Decimal | null;
  bloqueado: boolean;
  teto: Decimal | null;
  lanceAtual: Decimal | null;
}): Veredito {
  if (x.status === "descartado") return { tipo: "descartado", texto: "Descartado" };
  if (x.status === "vendido") return { tipo: "vendido", texto: "Vendido" };
  if (x.status === "arrematado") return { tipo: "arrematado", texto: "Arrematado" };
  if (x.status === "perdido") return { tipo: "perdido", texto: "Perdido" };
  if (!x.vendaProvavel || !x.lanceEconomico || !x.lanceAjustado) return { tipo: "sem_venda", texto: "Sem preço de venda" };
  if (x.lanceEconomico.lte(0) && x.lanceAjustado.lte(0)) return { tipo: "nao_vale", texto: "Não vale" };
  if (x.bloqueado || !x.teto) return { tipo: "bloqueado", texto: "Bloqueado: verificar" };
  if (x.lanceAjustado.lte(0)) return { tipo: "nao_vale_risco", texto: "Não vale no cenário de risco" };
  if (!x.lanceAtual) return { tipo: "ate", texto: `Até ${brl(x.teto.floor())}` };
  return x.lanceAtual.lte(x.teto)
    ? { tipo: "dentro", texto: "Dentro do limite" }
    : { tipo: "acima", texto: "Acima do limite" };
}
