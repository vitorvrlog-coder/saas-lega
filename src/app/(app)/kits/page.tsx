import { prisma } from "@/lib/db";
import { serializar } from "@/lib/serializar";
import { EditorKits } from "./editor";

export const dynamic = "force-dynamic";

export default async function KitsPage() {
  const kits = serializar(
    await prisma.kitDano.findMany({ orderBy: { ordem: "asc" }, include: { itens: { orderBy: { ordem: "asc" } } } }),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Kits de dano</h1>
      <p className="text-sm text-slate-600">
        Os kits adicionam itens ao lote como “inspecionar” e “inferido”, sem duplicar nomes que o lote já tem.
      </p>
      <EditorKits kits={kits} />
    </div>
  );
}
