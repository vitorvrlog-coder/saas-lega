"use server";

import { prisma } from "@/lib/db";
import { exigirLogin } from "@/lib/sessao";
import { CAMPOS, converterValor, type Entidade, type TipoCampo } from "@/lib/campos";

export type Resultado = { ok: true } | { ok: false; erro: string };

/** Salvamento automático de um único campo. */
export async function salvarCampo(entidade: Entidade, id: string, campo: string, valor: unknown): Promise<Resultado> {
  await exigirLogin();
  const tipo = (CAMPOS[entidade] as Record<string, TipoCampo>)[campo];
  if (!tipo) return { ok: false, erro: "Campo não editável" };
  let convertido: unknown;
  try {
    convertido = converterValor(tipo, valor);
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
  const data = { [campo]: convertido };
  try {
    switch (entidade) {
      case "lote":
        await prisma.lote.update({ where: { id }, data });
        break;
      case "item":
        await prisma.itemReparo.update({ where: { id }, data });
        break;
      case "risco":
        await prisma.risco.update({ where: { id }, data });
        break;
      case "parametros":
        await prisma.parametros.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
        break;
      case "kit":
        await prisma.kitDano.update({ where: { id }, data });
        break;
      case "kitItem":
        await prisma.kitDanoItem.update({ where: { id }, data });
        break;
    }
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, erro: "Erro ao salvar" };
  }
}
