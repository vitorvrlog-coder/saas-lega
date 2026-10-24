"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { exigirLogin } from "@/lib/sessao";
import { TIPO_PECA, type TipoPeca } from "@/lib/dominio";

export type NovaCotacao = {
  peca: string;
  modelo: string;
  tipo: TipoPeca;
  preco: string | null;
  fornecedor: string;
  link: string;
  data: string;
  observacao: string;
};

export async function criarCotacao(c: NovaCotacao): Promise<{ ok: true } | { ok: false; erro: string }> {
  await exigirLogin();
  if (!c.peca.trim()) return { ok: false, erro: "Informe a peça" };
  if (!(c.tipo in TIPO_PECA)) return { ok: false, erro: "Tipo inválido" };
  if (!c.preco || !/^\d+(\.\d+)?$/.test(c.preco) || Number(c.preco) <= 0) return { ok: false, erro: "Preço inválido" };
  if (!c.fornecedor.trim()) return { ok: false, erro: "Informe o fornecedor" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.data)) return { ok: false, erro: "Data inválida" };
  await prisma.cotacao.create({
    data: {
      peca: c.peca.trim(),
      modelo: c.modelo.trim() || null,
      tipo: c.tipo,
      preco: c.preco,
      fornecedor: c.fornecedor.trim(),
      link: c.link.trim() || null,
      data: new Date(`${c.data}T00:00:00Z`),
      observacao: c.observacao.trim() || null,
    },
  });
  revalidatePath("/pecas");
  return { ok: true };
}

/** Só para corrigir erro de digitação: cotações nunca são editadas. */
export async function apagarCotacao(id: string) {
  await exigirLogin();
  await prisma.cotacao.delete({ where: { id } });
  revalidatePath("/pecas");
}
