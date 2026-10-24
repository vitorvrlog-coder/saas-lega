import Link from "next/link";
import { carregarLotes } from "@/lib/lotes";
import { carregarParametros } from "@/lib/parametros";
import { resumirLote } from "@/lib/resumo";
import { criarLote } from "@/lib/actions/lotes";
import { CorVeredito } from "@/components/veredito";
import { Selo } from "@/components/ui";
import { STATUS } from "@/lib/dominio";
import { formatBRL, formatData } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LotesPage() {
  const [lotes, parametros] = await Promise.all([carregarLotes(), carregarParametros()]);
  const resumos = lotes.map((l) => resumirLote(l, parametros));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">Lotes</h1>
        <form action={criarLote} className="ml-auto">
          <button className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">+ Novo lote</button>
        </form>
      </div>
      {resumos.length === 0 && <p className="text-slate-600">Nenhum lote ainda.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {resumos.map((l) => (
          <Link
            key={l.id}
            href={`/lotes/${l.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-300 hover:shadow"
          >
            <div className="mb-2 flex items-start gap-2">
              <h2 className="font-semibold leading-snug text-slate-900">{l.nome}</h2>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Selo>{STATUS[l.status]}</Selo>
              <CorVeredito tipo={l.veredito.tipo} texto={l.veredito.texto} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Reparo provável</dt>
              <dd className="text-right tabular-nums">{formatBRL(l.reparoProvavel)}</dd>
              <dt className="text-slate-500">Lance atual</dt>
              <dd className="text-right tabular-nums">{formatBRL(l.lanceAtual)}</dd>
              <dt className="text-slate-500">Teto autorizado</dt>
              <dd className="text-right font-semibold tabular-nums">{formatBRL(l.teto)}</dd>
              <dt className="text-slate-500">Leilão</dt>
              <dd className="text-right">
                {formatData(l.dataLeilao)}
                {l.cidadePatio ? ` · ${l.cidadePatio}` : ""}
              </dd>
            </dl>
            {(l.bloqueios > 0 || l.alertas > 0) && (
              <p className="mt-2 text-xs text-slate-500">
                {l.bloqueios > 0 && <span className="text-red-700">{l.bloqueios} bloqueio(s)</span>}
                {l.bloqueios > 0 && l.alertas > 0 && " · "}
                {l.alertas > 0 && <span className="text-amber-700">{l.alertas} alerta(s)</span>}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
