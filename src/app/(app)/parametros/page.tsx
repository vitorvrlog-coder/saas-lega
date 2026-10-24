import { carregarParametros } from "@/lib/parametros";
import { FormParametros } from "./form";

export const dynamic = "force-dynamic";

export default async function ParametrosPage() {
  const p = await carregarParametros();
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Parâmetros</h1>
      <p className="text-sm text-slate-600">
        Valores padrão usados quando o campo correspondente do lote está vazio. Alterações salvam sozinhas.
      </p>
      <FormParametros p={p} />
    </div>
  );
}
