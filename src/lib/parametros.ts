import "server-only";
import { prisma } from "./db";
import { serializar } from "./serializar";
import type { ParametrosDTO } from "./dominio";

export async function carregarParametros(): Promise<ParametrosDTO> {
  const p = await prisma.parametros.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const { id: _id, ...resto } = serializar(p);
  return resto;
}
