import Decimal from "decimal.js";
import type { CotacaoDTO, TipoPeca } from "./dominio";
import { normalizar } from "./format";

export function chaveGrupo(c: Pick<CotacaoDTO, "peca" | "modelo" | "tipo">): string {
  return `${normalizar(c.peca)}|${normalizar(c.modelo)}|${c.tipo}`;
}

/** IDs das cotações com o menor preço em cada grupo peça + modelo + tipo (empate: a mais recente). */
export function idsMenorPreco(cotacoes: CotacaoDTO[]): Set<string> {
  const melhor = new Map<string, CotacaoDTO>();
  for (const c of cotacoes) {
    const k = chaveGrupo(c);
    const atual = melhor.get(k);
    const cmp = atual ? new Decimal(c.preco).cmp(atual.preco) : -1;
    if (!atual || cmp < 0 || (cmp === 0 && c.data > atual.data)) melhor.set(k, c);
  }
  return new Set([...melhor.values()].map((c) => c.id));
}

export type MenoresPorTipo = { porTipo: Partial<Record<TipoPeca, CotacaoDTO>>; mesmoModelo: boolean };

/**
 * Menor cotação de cada tipo para uma peça. Prefere cotações do mesmo modelo do lote;
 * se não houver nenhuma, usa qualquer modelo (mesmoModelo = false, para mostrar aviso).
 */
export function menoresParaPeca(cotacoes: CotacaoDTO[], peca: string, modelo: string | null): MenoresPorTipo | null {
  const daPeca = cotacoes.filter((c) => normalizar(c.peca) === normalizar(peca));
  if (daPeca.length === 0) return null;
  const doModelo = modelo ? daPeca.filter((c) => normalizar(c.modelo) === normalizar(modelo)) : [];
  const mesmoModelo = doModelo.length > 0;
  const base = mesmoModelo ? doModelo : daPeca;
  const porTipo: MenoresPorTipo["porTipo"] = {};
  for (const c of base) {
    const atual = porTipo[c.tipo];
    if (!atual || new Decimal(c.preco).lt(atual.preco)) porTipo[c.tipo] = c;
  }
  return { porTipo, mesmoModelo };
}
