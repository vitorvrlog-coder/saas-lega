import { prisma } from "@/lib/db";
import { serializar } from "@/lib/serializar";
import { TabelaPecas } from "./tabela";

export const dynamic = "force-dynamic";

export default async function PecasPage() {
  const cotacoes = serializar(await prisma.cotacao.findMany({ orderBy: [{ data: "desc" }, { createdAt: "desc" }] }));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tabela de peças (minhas cotações)</h1>
      <TabelaPecas cotacoes={cotacoes} />
    </div>
  );
}
