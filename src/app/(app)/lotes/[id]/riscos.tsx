"use client";

import { useTransition } from "react";
import { CampoDecimal, CampoTexto } from "@/components/campos";
import { Bloco, Botao } from "@/components/ui";
import { useRastrear } from "@/components/salvamento";
import { adicionarRisco, removerRisco } from "@/lib/actions/lotes";
import { calcularRiscos, dec, valorConservadorRisco, valorEsperadoRisco } from "@/lib/calc/motor";
import type { RiscoDTO } from "@/lib/dominio";
import { formatBRL } from "@/lib/format";

export function BlocoRiscos({
  loteId,
  riscos,
  setRiscos,
}: {
  loteId: string;
  riscos: RiscoDTO[];
  setRiscos: React.Dispatch<React.SetStateAction<RiscoDTO[]>>;
}) {
  const [pendente, iniciar] = useTransition();
  const rastrear = useRastrear();
  const totais = calcularRiscos(riscos);

  const atualizar = (id: string, campo: keyof RiscoDTO) => (v: unknown) =>
    setRiscos((xs) => xs.map((r) => (r.id === id ? { ...r, [campo]: v } : r)));

  return (
    <Bloco
      titulo="Riscos ocultos"
      acoes={
        <Botao
          variante="primario"
          disabled={pendente}
          onClick={() =>
            iniciar(async () => {
              const r = await rastrear(adicionarRisco(loteId));
              setRiscos((xs) => [...xs, r]);
            })
          }
        >
          + Risco
        </Botao>
      }
    >
      <div className="tabela-rolavel -mx-4 px-4">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="p-1">Risco</th>
              <th className="p-1">Chance (%)</th>
              <th className="p-1">Custo se acontecer</th>
              <th className="p-1 text-right">Valor esperado</th>
              <th className="p-1 text-right">Conservador</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {riscos.map((r) => {
              const p = (campo: keyof RiscoDTO) => ({ entidade: "risco" as const, id: r.id, campo, onChange: atualizar(r.id, campo) });
              const semCusto = dec(r.chancePct).gt(0) && !dec(r.custo).gt(0);
              return (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="p-1">
                    <CampoTexto {...p("nome")} valor={r.nome} className="min-w-64" />
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("chancePct")} valor={r.chancePct} casas={0} className="min-w-20" />
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("custo")} valor={r.custo} className={`min-w-32 ${semCusto ? "[&_input]:bg-amber-50" : ""}`} />
                    {semCusto && <span className="text-[11px] text-amber-700">custo não informado</span>}
                  </td>
                  <td className="p-1 text-right tabular-nums">{formatBRL(valorEsperadoRisco(r))}</td>
                  <td className="p-1 text-right tabular-nums text-slate-600">{formatBRL(valorConservadorRisco(r))}</td>
                  <td className="p-1 text-right">
                    <Botao
                      variante="link"
                      className="text-xs text-red-600"
                      onClick={() => {
                        if (!confirm(`Remover "${r.nome}"?`)) return;
                        setRiscos((xs) => xs.filter((x) => x.id !== r.id));
                        iniciar(() => rastrear(removerRisco(r.id)));
                      }}
                    >
                      remover
                    </Botao>
                  </td>
                </tr>
              );
            })}
            {riscos.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">
                  Nenhum risco cadastrado.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-slate-200">
            <tr>
              <td colSpan={3} className="p-1 text-right text-slate-600">
                Totais
              </td>
              <td className="p-1 text-right font-semibold tabular-nums">{formatBRL(totais.esperado)}</td>
              <td className="p-1 text-right font-semibold tabular-nums">{formatBRL(totais.conservador)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Valor esperado = chance × custo. No cenário conservador, riscos com chance ≥ 25% entram com o custo inteiro.
      </p>
    </Bloco>
  );
}
