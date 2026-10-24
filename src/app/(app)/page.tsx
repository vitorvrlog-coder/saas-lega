import Link from "next/link";
import { carregarLotes } from "@/lib/lotes";
import { carregarParametros } from "@/lib/parametros";
import { resumirLote } from "@/lib/resumo";
import { calcularIndicadores } from "@/lib/calc/posCompra";
import { CorVeredito } from "@/components/veredito";
import { Selo } from "@/components/ui";
import { STATUS } from "@/lib/dominio";
import { formatBRL, formatPct } from "@/lib/format";
import { LinhaClicavel } from "@/components/linha-clicavel";

export const dynamic = "force-dynamic";

function Indicador({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{rotulo}</div>
      <div className="text-xl font-semibold tabular-nums">{valor}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default async function Painel() {
  const [lotes, parametros] = await Promise.all([carregarLotes(), carregarParametros()]);
  const ind = calcularIndicadores(lotes, parametros);
  const resumos = lotes.map((l) => resumirLote(l, parametros));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Painel</h1>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Indicador rotulo="Lotes em avaliação" valor={String(ind.emAvaliacao)} sub="triagem + avaliando" />
        <Indicador rotulo="Marcados para dar lance" valor={String(ind.darLance)} sub={`soma dos tetos ${formatBRL(ind.somaTetos)}`} />
        <Indicador rotulo="Capital em carros arrematados" valor={formatBRL(ind.capitalInvestido)} sub="custo real até agora" />
        <Indicador
          rotulo="Reparo real × previsto"
          valor={ind.desvioReparoPct === null ? "—" : `${ind.desvioReparoPct.gt(0) ? "+" : ""}${formatPct(ind.desvioReparoPct)}`}
          sub="arrematados e vendidos"
        />
        <Indicador rotulo="Lucro realizado" valor={formatBRL(ind.lucroRealizado)} sub={`${ind.vendidos} vendido(s)`} />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center">
          <h2 className="font-semibold">Todos os lotes</h2>
          <Link href="/lotes" className="ml-auto text-sm text-sky-700">
            ver cards →
          </Link>
        </div>
        <div className="tabela-rolavel">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="p-2">Veículo</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Reparo provável</th>
                <th className="p-2 text-right">Lance atual</th>
                <th className="p-2 text-right">Teto autorizado</th>
                <th className="p-2">Veredito</th>
              </tr>
            </thead>
            <tbody>
              {resumos.map((l) => (
                <LinhaClicavel key={l.id} href={`/lotes/${l.id}`}>
                  <td className="p-2">
                    <Link href={`/lotes/${l.id}`} className="font-medium text-slate-900 hover:text-sky-700">
                      {l.nome}
                    </Link>
                    {l.veiculo && <div className="text-xs text-slate-500">{l.veiculo}</div>}
                  </td>
                  <td className="p-2">
                    <Selo>{STATUS[l.status]}</Selo>
                  </td>
                  <td className="p-2 text-right tabular-nums">{formatBRL(l.reparoProvavel)}</td>
                  <td className="p-2 text-right tabular-nums">{formatBRL(l.lanceAtual)}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{formatBRL(l.teto)}</td>
                  <td className="p-2">
                    <CorVeredito tipo={l.veredito.tipo} texto={l.veredito.texto} />
                  </td>
                </LinhaClicavel>
              ))}
              {resumos.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-slate-500">
                    Nenhum lote.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
