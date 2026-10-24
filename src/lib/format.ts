import Decimal from "decimal.js";

type Num = Decimal | string | number | null | undefined;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function toDec(v: Num): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function formatBRL(v: Num, vazio = "—"): string {
  const d = toDec(v);
  return d === null ? vazio : brl.format(d.toNumber());
}

export function formatNum(v: Num, vazio = ""): string {
  const d = toDec(v);
  return d === null ? vazio : num.format(d.toNumber());
}

export function formatPct(v: Num, vazio = "—"): string {
  const d = toDec(v);
  return d === null ? vazio : `${num.format(d.toDecimalPlaces(1).toNumber())}%`;
}

/** Valor de input (em formato brasileiro "1.234,56" ou "1234.56") → string decimal canônica, ou null. */
export function parseDecimalBR(texto: string): string | null {
  let s = texto.trim().replace(/R\$\s?/g, "").replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "15.000" → milhar
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s).toString();
}

/** String decimal canônica → texto para edição ("1234.5" → "1.234,50"). `casas` é o mínimo de decimais (máximo 2). */
export function decimalParaInput(v: string | null | undefined, casas = 2): string {
  const d = toDec(v);
  if (d === null) return "";
  return d.toNumber().toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 2) });
}

export function formatData(iso: string | null | undefined, vazio = "—"): string {
  if (!iso) return vazio;
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Normaliza nomes para comparação: minúsculas, sem acento, espaços colapsados. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
