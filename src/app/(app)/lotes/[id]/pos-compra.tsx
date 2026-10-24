"use client";

import { CampoData, CampoDecimal } from "@/components/campos";
import { Bloco } from "@/components/ui";
import type { Resultado } from "@/lib/calc/motor";
import { calcularPosCompra } from "@/lib/calc/posCompra";
import type { ItemDTO, LoteDTO, ParametrosDTO } from "@/lib/dominio";
import { formatBRL, formatPct } from "@/lib/format";
import type { CampoLoteProps } from "./editor";

function Linha({ rotulo, previsto, real, forte }: { rotulo: string; previsto?: string; real: string; forte?: boolean }) {
  return (
    <tr className={`border-t border-slate-100 ${forte ? "font-semibold" : ""}`}>
      <td className="py-1 pr-2">{rotulo}</td>
      <td className="py-1 pr-2 text-right tabular-nums text-slate-500">{previsto ?? ""}</td>
      <td className="py-1 text-right tabular-nums">{real}</td>
    </tr>
  );
}

export function BlocoPosCompra({
  f,
  lote,
  itens,
  parametros,
  resultado: r,
}: {
  f: CampoLoteProps;
  lote: LoteDTO;
  itens: ItemDTO[];
  parametros: ParametrosDTO;
  resultado: Resultado;
}) {
  const pc = calcularPosCompra(lote, itens, r.reparo.provavel, parametros);
  const k = r.custos;
  // Lucro que o modelo previa para o lance efetivamente arrematado.
  const lucroPrevisto = r.vendaProvavel
    ? r.vendaProvavel.minus(pc.custoLance.plus(r.reparo.provavel).plus(r.riscos.esperado).plus(k.fixos))
    : null;
  const desvioCor = pc.desvioReparoPct === null ? "" : pc.desvioReparoPct.gt(0) ? "text-red-700" : "text-emerald-700";

  return (
    <Bloco titulo="Pós-compra (real)" className="border-indigo-200">
      <p className="mb-3 text-xs text-slate-500">
        Valores reais ficam separados do previsto. O custo real de cada peça é lançado na coluna “Custo real” da tabela
        de peças (peça + mão de obra + agregados).
      </p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <CampoDecimal {...f("lanceArrematado")} rotulo="Lance arrematado" prefixo="R$" />
        <CampoData {...f("dataArremate")} rotulo="Data do arremate" />
        <CampoDecimal {...f("taxasReais")} rotulo="Taxas reais" prefixo="R$" />
        <CampoDecimal {...f("transporteReal")} rotulo="Transporte real" prefixo="R$" />
        <CampoDecimal {...f("documentacaoReal")} rotulo="Documentação real" prefixo="R$" />
        <CampoDecimal {...f("outrosGastos")} rotulo="Outros gastos" prefixo="R$" />
        <CampoDecimal {...f("precoVenda")} rotulo="Preço de venda" prefixo="R$" />
        <CampoData {...f("dataVenda")} rotulo="Data da venda" />
        <CampoDecimal {...f("custosVendaReais")} rotulo="Custos de venda reais" prefixo="R$" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="tabela-rolavel">
          <table className="w-full min-w-[360px] text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left"></th>
                <th className="text-right">Previsto</th>
                <th className="text-right">Real</th>
              </tr>
            </thead>
            <tbody>
              <Linha
                rotulo={`Lance × (1 + ${formatPct(k.comissaoPct)})`}
                real={formatBRL(pc.custoLance)}
              />
              <Linha rotulo="Taxas do leilão" previsto={formatBRL(k.taxasLeilao)} real={formatBRL(lote.taxasReais)} />
              <Linha rotulo="Transporte" previsto={formatBRL(k.transporte)} real={formatBRL(lote.transporteReal)} />
              <Linha rotulo="Documentação" previsto={formatBRL(k.documentacao)} real={formatBRL(lote.documentacaoReal)} />
              <Linha
                rotulo="Reparo (Σ custo real dos itens)"
                previsto={formatBRL(r.reparo.provavel)}
                real={pc.temCustoReal ? formatBRL(pc.custoRealItens) : "—"}
              />
              <Linha rotulo="Outros gastos" real={formatBRL(lote.outrosGastos)} />
              <Linha rotulo="Custo real total" real={formatBRL(pc.custoRealTotal)} forte />
              <Linha rotulo="Preço de venda" previsto={formatBRL(r.vendaProvavel)} real={formatBRL(lote.precoVenda)} />
              <Linha rotulo="Custos de venda" previsto={formatBRL(k.custosVenda)} real={formatBRL(lote.custosVendaReais)} />
              <Linha
                rotulo="Lucro real"
                previsto={formatBRL(lucroPrevisto)}
                real={formatBRL(pc.lucroReal)}
                forte
              />
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-2 self-start">
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Reparo real × previsto</div>
            <div className={`text-lg font-semibold tabular-nums ${desvioCor}`}>
              {pc.desvioReparoPct === null
                ? "—"
                : `${pc.desvioReparoPct.gt(0) ? "+" : ""}${formatPct(pc.desvioReparoPct)}`}
            </div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Custo real total</div>
            <div className="text-lg font-semibold tabular-nums">{formatBRL(pc.custoRealTotal)}</div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Lucro real</div>
            <div className={`text-lg font-semibold tabular-nums ${pc.lucroReal?.lt(0) ? "text-red-700" : ""}`}>
              {formatBRL(pc.lucroReal)}
            </div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Dias do arremate à venda</div>
            <div className="text-lg font-semibold tabular-nums">{pc.dias ?? "—"}</div>
          </div>
        </div>
      </div>
    </Bloco>
  );
}
