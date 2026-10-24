import type { TipoVeredito } from "@/lib/calc/motor";

const COR: Record<TipoVeredito, string> = {
  descartado: "bg-slate-200 text-slate-700",
  perdido: "bg-slate-200 text-slate-700",
  vendido: "bg-emerald-600 text-white",
  arrematado: "bg-indigo-600 text-white",
  sem_venda: "bg-slate-100 text-slate-700 ring-1 ring-slate-300",
  nao_vale: "bg-red-600 text-white",
  nao_vale_risco: "bg-red-100 text-red-800",
  bloqueado: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  ate: "bg-sky-600 text-white",
  dentro: "bg-emerald-100 text-emerald-800",
  acima: "bg-red-100 text-red-800",
};

export function CorVeredito({ tipo, texto, grande }: { tipo: TipoVeredito; texto: string; grande?: boolean }) {
  return (
    <span
      className={`inline-block rounded-full font-semibold whitespace-nowrap ${grande ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"} ${COR[tipo]}`}
    >
      {texto}
    </span>
  );
}
