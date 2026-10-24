// Pós-compra e indicadores do Painel. Funções puras.
import Decimal from "decimal.js";
import type { ItemDTO, LoteCompletoDTO, LoteDTO, ParametrosDTO } from "../dominio";
import { calcularLote, dec, resolverCustos } from "./motor";

const ZERO = new Decimal(0);
const temValor = (v: string | null | undefined) => v !== null && v !== undefined && v !== "";

export type PosCompraEntrada = Pick<
  LoteDTO,
  | "comissaoPct"
  | "lanceArrematado"
  | "dataArremate"
  | "taxasReais"
  | "transporteReal"
  | "documentacaoReal"
  | "outrosGastos"
  | "precoVenda"
  | "dataVenda"
  | "custosVendaReais"
>;

export type PosCompra = {
  custoLance: Decimal;
  custoRealItens: Decimal;
  /** Há pelo menos um item com custo real lançado. */
  temCustoReal: boolean;
  reparoPrevisto: Decimal;
  /** (real − previsto) ÷ previsto × 100; null sem custo real ou previsto zero. */
  desvioReparoPct: Decimal | null;
  custoRealTotal: Decimal;
  lucroReal: Decimal | null;
  dias: number | null;
};

export function diasEntre(inicio: string | null, fim: string | null): number | null {
  if (!inicio || !fim) return null;
  const ms = Date.parse(`${fim.slice(0, 10)}T00:00:00Z`) - Date.parse(`${inicio.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

export function calcularPosCompra(
  lote: PosCompraEntrada,
  itens: Pick<ItemDTO, "custoReal">[],
  reparoPrevisto: Decimal,
  parametros: ParametrosDTO,
): PosCompra {
  const { c } = resolverCustos({ comissaoPct: lote.comissaoPct }, parametros);
  const comCusto = itens.filter((i) => temValor(i.custoReal));
  const custoRealItens = comCusto.reduce((a, i) => a.plus(dec(i.custoReal)), ZERO);
  const temCustoReal = comCusto.length > 0;
  const custoLance = dec(lote.lanceArrematado).times(c.plus(1));
  const custoRealTotal = custoLance
    .plus(dec(lote.taxasReais))
    .plus(dec(lote.transporteReal))
    .plus(dec(lote.documentacaoReal))
    .plus(custoRealItens)
    .plus(dec(lote.outrosGastos));
  const lucroReal = temValor(lote.precoVenda)
    ? dec(lote.precoVenda).minus(dec(lote.custosVendaReais)).minus(custoRealTotal)
    : null;
  return {
    custoLance,
    custoRealItens,
    temCustoReal,
    reparoPrevisto,
    desvioReparoPct:
      temCustoReal && reparoPrevisto.gt(0) ? custoRealItens.minus(reparoPrevisto).div(reparoPrevisto).times(100) : null,
    custoRealTotal,
    lucroReal,
    dias: diasEntre(lote.dataArremate, lote.dataVenda),
  };
}

export type Indicadores = {
  emAvaliacao: number;
  darLance: number;
  somaTetos: Decimal;
  capitalInvestido: Decimal;
  desvioReparoPct: Decimal | null;
  lucroRealizado: Decimal;
  vendidos: number;
};

export function calcularIndicadores(lotes: LoteCompletoDTO[], parametros: ParametrosDTO): Indicadores {
  let emAvaliacao = 0;
  let darLance = 0;
  let somaTetos = ZERO;
  let capitalInvestido = ZERO;
  let somaReal = ZERO;
  let somaPrevisto = ZERO;
  let algumReal = false;
  let lucroRealizado = ZERO;
  let vendidos = 0;

  for (const l of lotes) {
    const r = calcularLote({ lote: l, itens: l.itens, riscos: l.riscos, parametros });
    if (l.status === "triagem" || l.status === "avaliando") emAvaliacao++;
    if (l.status === "dar_lance") {
      darLance++;
      somaTetos = somaTetos.plus(r.teto ?? ZERO);
    }
    if (l.status === "arrematado" || l.status === "vendido") {
      const pc = calcularPosCompra(l, l.itens, r.reparo.provavel, parametros);
      if (l.status === "arrematado") capitalInvestido = capitalInvestido.plus(pc.custoRealTotal);
      if (pc.temCustoReal) {
        algumReal = true;
        somaReal = somaReal.plus(pc.custoRealItens);
        somaPrevisto = somaPrevisto.plus(r.reparo.provavel);
      }
      if (l.status === "vendido" && pc.lucroReal) {
        vendidos++;
        lucroRealizado = lucroRealizado.plus(pc.lucroReal);
      }
    }
  }

  return {
    emAvaliacao,
    darLance,
    somaTetos,
    capitalInvestido,
    desvioReparoPct: algumReal && somaPrevisto.gt(0) ? somaReal.minus(somaPrevisto).div(somaPrevisto).times(100) : null,
    lucroRealizado,
    vendidos,
  };
}
