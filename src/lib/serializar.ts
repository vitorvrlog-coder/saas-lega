import { Prisma } from "@prisma/client";

type Serializado<T> = T extends Prisma.Decimal
  ? string
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? Serializado<U>[]
      : T extends object
        ? { [K in keyof T]: Serializado<T[K]> }
        : T;

/** Converte Decimal → string e Date → "AAAA-MM-DD" (UTC, já que as datas são @db.Date) recursivamente. */
export function serializar<T>(valor: T): Serializado<T> {
  if (valor === null || valor === undefined) return valor as Serializado<T>;
  if (Prisma.Decimal.isDecimal(valor)) return (valor as Prisma.Decimal).toString() as Serializado<T>;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10) as Serializado<T>;
  if (Array.isArray(valor)) return valor.map(serializar) as Serializado<T>;
  if (typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) out[k] = serializar(v);
    return out as Serializado<T>;
  }
  return valor as Serializado<T>;
}
