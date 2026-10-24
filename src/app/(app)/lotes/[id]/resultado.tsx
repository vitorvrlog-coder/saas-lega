"use client";

import Decimal from "decimal.js";
import { Bloco } from "@/components/ui";
import { CorVeredito } from "@/components/veredito";
import type { Resultado } from "@/lib/calc/motor";
import type { LoteDTO } from "@/lib/dominio";
import { formatBRL, formatPct } from "@/lib/format";

type Linha = { op?: "−" | "+" | "=" | "÷" | "×"; rotulo: string; valor: string; forte?: boolean; detalhe?: string };

function Conta({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <h4 className="mb-1 text-sm font-semibold text-slate-700">{titulo}</h4>
      <table className="w-full text-sm">
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className={l.op === "=" ? "border-t border-slate-200" : ""}>
              <td className="w-5 py-0.5 text-slate-400">{l.op}</td>
              <td className={`py-0.5 ${l.forte ? "font-semibold" : ""}`}>
                {l.rotulo}
                {l.detalhe && <span className="block text-xs text-slate-500">{l.detalhe}</span>}
              </td>
              <td className={`py-0.5 text-right tabular-nums whitespace-nowrap ${l.forte ? "font-semibold" : ""}`}>{l.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Numero({ rotulo, valor, destaque, sub }: { rotulo: string; valor: string; destaque?: boolean; sub?: string }) {
  return (
    <div className={`rounded-md p-2 sm:p-3 ${destaque ? "col-span-2 bg-sky-50 ring-1 ring-sky-200 sm:col-span-1" : "bg-slate-50"}`}>
      <div className="text-xs text-slate-600">{rotulo}</div>
      <div className={`tabular-nums ${destaque ? "text-2xl font-bold text-sky-900" : "text-base font-semibold sm:text-lg"}`}>{valor}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function BlocoResultado({ resultado: r, lote }: { resultado: Resultado; lote: LoteDTO }) {
  const { custos: k } = r;
  const fatorComissao = k.c.plus(1);
  const pctComissao = `${formatPct(k.comissaoPct)}${k.padrao.has("comissaoPct") ? " (padrão)" : ""}`;
  const detalheFixos = [
    `taxas ${formatBRL(k.taxasLeilao)}`,
    `transporte ${formatBRL(k.transporte)}`,
    `documentação ${formatBRL(k.documentacao)}`,
    `venda ${formatBRL(k.custosVenda)}`,
    `capital ${formatBRL(k.custoCapital)}`,
    `tributos ${formatBRL(k.tributos)}`,
  ].join(" · ");

  const contaLance = (
    venda: Decimal,
    rotuloVenda: string,
    reparo: Decimal,
    rotuloReparo: string,
    detalheReparo: string,
    risco: Decimal,
    rotuloRisco: string,
    resultadoFinal: Decimal,
    rotuloFinal: string,
  ): Linha[] => {
    const margem = venda.minus(reparo).minus(risco).minus(k.fixos).minus(k.lucroMinimo);
    return [
      { rotulo: rotuloVenda, valor: formatBRL(venda) },
      { op: "−", rotulo: rotuloReparo, valor: formatBRL(reparo), detalhe: detalheReparo },
      { op: "−", rotulo: rotuloRisco, valor: formatBRL(risco) },
      { op: "−", rotulo: "Custos fixos", valor: formatBRL(k.fixos), detalhe: detalheFixos },
      { op: "−", rotulo: `Lucro mínimo${k.padrao.has("lucroMinimo") ? " (padrão)" : ""}`, valor: formatBRL(k.lucroMinimo) },
      { op: "=", rotulo: "Sobra para lance + comissão", valor: formatBRL(margem) },
      { op: "÷", rotulo: `(1 + comissão ${pctComissao})`, valor: fatorComissao.toString().replace(".", ",") },
      { op: "=", rotulo: rotuloFinal, valor: formatBRL(resultadoFinal), forte: true },
    ];
  };

  const rp = r.reparo;
  const vendaTexto =
    r.vendaRapida && r.vendaProvavel && r.vendaRapida.lt(r.vendaProvavel) ? "Venda rápida (menor que a provável)" : "Venda provável";

  return (
    <Bloco
      titulo="Resultado / lance máximo"
      acoes={<CorVeredito tipo={r.veredito.tipo} texto={r.veredito.texto} grande />}
      className="border-sky-200"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Numero
          rotulo="Teto autorizado"
          valor={r.teto ? formatBRL(r.teto.floor()) : "—"}
          destaque
          sub={r.teto ? "lance ajustado ao risco" : r.bloqueios.length ? "bloqueado: resolva os itens abaixo" : "sem preço de venda"}
        />
        <Numero rotulo="Lance ajustado ao risco" valor={formatBRL(r.lanceAjustado?.floor())} sub="cenário conservador" />
        <Numero rotulo="Lance máximo econômico" valor={formatBRL(r.lanceEconomico?.floor())} sub="cenário provável" />
        <Numero
          rotulo="Com peças mais baratas"
          valor={formatBRL(r.lanceEconomicoPecasBaratas?.floor())}
          sub="cenário econômico"
        />
      </div>

      {r.noLanceAtual && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Numero rotulo="Lance atual" valor={formatBRL(r.noLanceAtual.lance)} sub={`com comissão: ${formatBRL(r.noLanceAtual.custoLance)}`} />
          <Numero rotulo="Lucro projetado no lance atual" valor={formatBRL(r.noLanceAtual.lucro)} />
          <Numero rotulo="Capital necessário" valor={formatBRL(r.noLanceAtual.capital)} />
          <Numero rotulo="Retorno" valor={r.noLanceAtual.retorno ? formatPct(r.noLanceAtual.retorno.times(100)) : "—"} />
        </div>
      )}

      {r.bloqueios.length > 0 && (
        <ul className="mt-3 space-y-1">
          {r.bloqueios.map((b) => (
            <li key={b.codigo} className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">
              ⛔ {b.mensagem}
            </li>
          ))}
        </ul>
      )}
      {r.alertas.length > 0 && (
        <ul className="mt-2 space-y-1">
          {r.alertas.map((a) => (
            <li key={a.codigo} className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-800">
              ⚠ {a.mensagem}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-sky-700">Ver a conta detalhada</summary>
        {!r.vendaProvavel ? (
          <p className="mt-2 text-sm text-slate-600">Informe a venda provável em “Mercado e custos” para calcular os lances.</p>
        ) : (
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <Conta
              titulo="Lance ajustado ao risco → teto"
              linhas={[
                ...contaLance(
                  r.vendaAjustada!,
                  vendaTexto,
                  rp.conservador,
                  "Reparo conservador",
                  `peças original/maior ${formatBRL(rp.pecasConservador)} + a inspecionar ${formatBRL(rp.inspecionarConservador)} + MO ${formatBRL(rp.maoDeObra)} + agregados ${formatBRL(rp.agregados)}`,
                  r.riscos.conservador,
                  "Risco conservador (custo cheio se chance ≥ 25%)",
                  r.lanceAjustado!,
                  "Lance ajustado ao risco",
                ),
                {
                  op: "=",
                  rotulo: "Teto autorizado",
                  valor: r.teto ? formatBRL(r.teto) : "bloqueado",
                  forte: true,
                  detalhe: r.teto ? "mínimo zero" : "não liberado enquanto houver bloqueio",
                },
              ]}
            />
            <Conta
              titulo="Lance máximo econômico"
              linhas={contaLance(
                r.vendaProvavel,
                "Venda provável",
                rp.provavel,
                "Reparo provável",
                `peças ${formatBRL(rp.pecasProvavel)} + MO ${formatBRL(rp.maoDeObra)} + agregados ${formatBRL(rp.agregados)} (sem itens a inspecionar)`,
                r.riscos.esperado,
                "Risco esperado (Σ chance × custo)",
                r.lanceEconomico!,
                "Lance máximo econômico",
              )}
            />
            <Conta
              titulo="Variante com peças mais baratas"
              linhas={contaLance(
                r.vendaProvavel,
                "Venda provável",
                rp.economico,
                "Reparo econômico",
                `menor preço de cada peça ${formatBRL(rp.pecasEconomico)} + MO ${formatBRL(rp.maoDeObra)} + agregados ${formatBRL(rp.agregados)}`,
                r.riscos.esperado,
                "Risco esperado",
                r.lanceEconomicoPecasBaratas!,
                "Lance com peças mais baratas",
              )}
            />
            {r.noLanceAtual && (
              <Conta
                titulo={`No lance atual (${formatBRL(r.noLanceAtual.lance)})`}
                linhas={[
                  { rotulo: "Venda provável", valor: formatBRL(r.vendaProvavel) },
                  { op: "−", rotulo: `Lance × (1 + ${pctComissao})`, valor: formatBRL(r.noLanceAtual.custoLance) },
                  { op: "−", rotulo: "Reparo provável", valor: formatBRL(rp.provavel) },
                  { op: "−", rotulo: "Risco esperado", valor: formatBRL(r.riscos.esperado) },
                  { op: "−", rotulo: "Custos fixos", valor: formatBRL(k.fixos) },
                  { op: "=", rotulo: "Lucro projetado", valor: formatBRL(r.noLanceAtual.lucro), forte: true },
                  {
                    rotulo: "Capital = lance com comissão + reparo provável + taxas + transporte + documentação",
                    valor: formatBRL(r.noLanceAtual.capital),
                  },
                  {
                    rotulo: "Retorno = lucro ÷ capital",
                    valor: r.noLanceAtual.retorno ? formatPct(r.noLanceAtual.retorno.times(100)) : "—",
                    forte: true,
                  },
                ]}
              />
            )}
          </div>
        )}
        {lote.lanceAtual === null && r.vendaProvavel && (
          <p className="mt-2 text-xs text-slate-500">Informe o lance atual em “Dados do lote” para ver lucro e retorno nesse lance.</p>
        )}
      </details>
    </Bloco>
  );
}
