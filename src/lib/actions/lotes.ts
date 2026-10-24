"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { exigirLogin } from "@/lib/sessao";
import { serializar } from "@/lib/serializar";
import { menoresParaPeca } from "@/lib/cotacoes";
import { itensNovosDoKit } from "@/lib/kits";
import { formatData } from "@/lib/format";
import { TIPO_PECA, type ItemDTO, type RiscoDTO, type TipoPeca } from "@/lib/dominio";

export async function criarLote() {
  await exigirLogin();
  const l = await prisma.lote.create({ data: { nome: "Novo lote" } });
  redirect(`/lotes/${l.id}`);
}

export async function apagarLote(id: string) {
  await exigirLogin();
  await prisma.lote.delete({ where: { id } });
  revalidatePath("/lotes");
  redirect("/lotes");
}

async function proximaOrdem(loteId: string, tabela: "item" | "risco") {
  const agg =
    tabela === "item"
      ? await prisma.itemReparo.aggregate({ where: { loteId }, _max: { ordem: true } })
      : await prisma.risco.aggregate({ where: { loteId }, _max: { ordem: true } });
  return (agg._max.ordem ?? -1) + 1;
}

export async function adicionarItem(loteId: string): Promise<ItemDTO> {
  await exigirLogin();
  const i = await prisma.itemReparo.create({
    data: { loteId, descricao: "Nova peça/serviço", ordem: await proximaOrdem(loteId, "item") },
  });
  return serializar(i);
}

export async function removerItem(id: string) {
  await exigirLogin();
  await prisma.itemReparo.delete({ where: { id } });
}

export async function adicionarRisco(loteId: string): Promise<RiscoDTO> {
  await exigirLogin();
  const r = await prisma.risco.create({
    data: { loteId, nome: "Novo risco", ordem: await proximaOrdem(loteId, "risco") },
  });
  return serializar(r);
}

export async function removerRisco(id: string) {
  await exigirLogin();
  await prisma.risco.delete({ where: { id } });
}

/** Adiciona os itens do kit como "inspecionar" + "inferido", sem duplicar nomes já existentes no lote. */
export async function aplicarKit(loteId: string, kitId: string): Promise<{ novos: ItemDTO[]; ignorados: number }> {
  await exigirLogin();
  const [kit, existentes] = await Promise.all([
    prisma.kitDano.findUniqueOrThrow({ where: { id: kitId }, include: { itens: { orderBy: { ordem: "asc" } } } }),
    prisma.itemReparo.findMany({ where: { loteId }, select: { descricao: true } }),
  ]);
  const novos = itensNovosDoKit(
    existentes.map((e) => e.descricao),
    kit.itens,
  );
  let ordem = await proximaOrdem(loteId, "item");
  const criados = await prisma.$transaction(
    novos.map((k) =>
      prisma.itemReparo.create({
        data: {
          loteId,
          sistema: k.sistema,
          descricao: k.descricao,
          quantidade: k.quantidade,
          situacao: "inspecionar",
          informacao: "inferido",
          validado: false,
          ordem: ordem++,
        },
      }),
    ),
  );
  return { novos: serializar(criados), ignorados: kit.itens.length - novos.length };
}

/** Copia para a linha o menor preço de cada tipo encontrado na tabela de peças. */
export async function puxarMenorPreco(
  itemId: string,
): Promise<{ ok: true; item: ItemDTO; aviso: string | null } | { ok: false; erro: string }> {
  await exigirLogin();
  const item = await prisma.itemReparo.findUniqueOrThrow({ where: { id: itemId }, include: { lote: true } });
  const cotacoes = serializar(await prisma.cotacao.findMany());
  const m = menoresParaPeca(cotacoes, item.descricao, item.lote.modelo);
  if (!m) return { ok: false, erro: `Nenhuma cotação para "${item.descricao}" na tabela de peças` };

  const campo: Record<TipoPeca, "precoOriginal" | "precoParalela" | "precoUsada"> = {
    original: "precoOriginal",
    paralela: "precoParalela",
    usada: "precoUsada",
  };
  const data: Record<string, unknown> = {};
  const fontes: string[] = [];
  for (const [tipo, c] of Object.entries(m.porTipo) as [TipoPeca, (typeof cotacoes)[number]][]) {
    data[campo[tipo]] = c.preco;
    fontes.push(`${TIPO_PECA[tipo]}: ${c.fornecedor} ${formatData(c.data)}${m.mesmoModelo ? "" : ` (${c.modelo ?? "sem modelo"})`}`);
  }
  data.fontePreco = `Cotação — ${fontes.join("; ")}`;
  const atualizado = await prisma.itemReparo.update({ where: { id: itemId }, data });
  return {
    ok: true,
    item: serializar(atualizado),
    aviso: m.mesmoModelo ? null : `Sem cotação para o modelo ${item.lote.modelo ?? "(vazio)"}; usei cotações de outros modelos.`,
  };
}

/** Grava cada preço preenchido da linha como uma nova cotação (nunca sobrescreve as antigas). */
export async function salvarItemComoCotacao(
  itemId: string,
  fornecedor: string,
  data: string,
): Promise<{ ok: true; criadas: number } | { ok: false; erro: string }> {
  await exigirLogin();
  if (!fornecedor.trim()) return { ok: false, erro: "Informe o fornecedor" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, erro: "Data inválida" };
  const item = await prisma.itemReparo.findUniqueOrThrow({ where: { id: itemId }, include: { lote: true } });
  const precos: [TipoPeca, typeof item.precoOriginal][] = [
    ["original", item.precoOriginal],
    ["paralela", item.precoParalela],
    ["usada", item.precoUsada],
  ];
  const validos = precos.filter(([, p]) => p !== null && p.gt(0));
  if (validos.length === 0) return { ok: false, erro: "A linha não tem preço preenchido" };
  await prisma.cotacao.createMany({
    data: validos.map(([tipo, preco]) => ({
      peca: item.descricao,
      modelo: item.lote.modelo,
      tipo,
      preco: preco!,
      fornecedor: fornecedor.trim(),
      data: new Date(`${data}T00:00:00Z`),
      observacao: `Salva a partir do lote "${item.lote.nome}"`,
    })),
  });
  revalidatePath("/pecas");
  return { ok: true, criadas: validos.length };
}
