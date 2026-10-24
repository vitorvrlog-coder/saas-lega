import "server-only";
import { prisma } from "./db";
import { serializar } from "./serializar";
import type { LoteCompletoDTO } from "./dominio";

const incluir = {
  itens: { orderBy: [{ ordem: "asc" as const }, { id: "asc" as const }] },
  riscos: { orderBy: [{ ordem: "asc" as const }, { id: "asc" as const }] },
};

export async function carregarLote(id: string): Promise<LoteCompletoDTO | null> {
  const l = await prisma.lote.findUnique({ where: { id }, include: incluir });
  return l ? (serializar(l) as LoteCompletoDTO) : null;
}

export async function carregarLotes(): Promise<LoteCompletoDTO[]> {
  const ls = await prisma.lote.findMany({ include: incluir, orderBy: { updatedAt: "desc" } });
  return serializar(ls) as LoteCompletoDTO[];
}
