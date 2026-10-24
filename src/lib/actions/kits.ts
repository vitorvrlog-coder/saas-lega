"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { exigirLogin } from "@/lib/sessao";
import { serializar } from "@/lib/serializar";

export async function criarKit() {
  await exigirLogin();
  const agg = await prisma.kitDano.aggregate({ _max: { ordem: true } });
  await prisma.kitDano.create({ data: { nome: "Novo kit", ordem: (agg._max.ordem ?? -1) + 1 } });
  revalidatePath("/kits");
}

export async function apagarKit(id: string) {
  await exigirLogin();
  await prisma.kitDano.delete({ where: { id } });
  revalidatePath("/kits");
}

export async function adicionarItemKit(kitId: string) {
  await exigirLogin();
  const agg = await prisma.kitDanoItem.aggregate({ where: { kitId }, _max: { ordem: true } });
  const i = await prisma.kitDanoItem.create({
    data: { kitId, descricao: "Nova peça", ordem: (agg._max.ordem ?? -1) + 1 },
  });
  return serializar(i);
}

export async function removerItemKit(id: string) {
  await exigirLogin();
  await prisma.kitDanoItem.delete({ where: { id } });
}
