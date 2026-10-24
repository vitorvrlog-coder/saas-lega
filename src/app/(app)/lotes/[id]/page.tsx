import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { carregarLote } from "@/lib/lotes";
import { carregarParametros } from "@/lib/parametros";
import { EditorLote } from "./editor";

export const dynamic = "force-dynamic";

export default async function LotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lote, parametros, kits] = await Promise.all([
    carregarLote(id),
    carregarParametros(),
    prisma.kitDano.findMany({ orderBy: { ordem: "asc" }, select: { id: true, nome: true } }),
  ]);
  if (!lote) notFound();
  return <EditorLote inicial={lote} parametros={parametros} kits={kits} />;
}
