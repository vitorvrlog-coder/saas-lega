"use client";

import { CampoDecimal, CampoTexto } from "@/components/campos";
import { Bloco } from "@/components/ui";
import type { CampoCusto, Resultado } from "@/lib/calc/motor";
import type { LoteDTO, ParametrosDTO } from "@/lib/dominio";
import { formatBRL, formatPct } from "@/lib/format";
import type { CampoLoteProps } from "./editor";

const CUSTOS: [CampoCusto, string][] = [
  ["lucroMinimo", "Lucro mínimo do lote"],
  ["comissaoPct", "Comissão do leiloeiro (%)"],
  ["taxasLeilao", "Taxas do leilão"],
  ["transporte", "Transporte"],
  ["documentacao", "Documentação"],
  ["custosVenda", "Custos de venda"],
  ["custoCapital", "Custo do capital"],
  ["tributos", "Tributos"],
];

export function BlocoMercado({
  f,
  lote,
  parametros,
  resultado,
}: {
  f: CampoLoteProps;
  lote: LoteDTO;
  parametros: ParametrosDTO;
  resultado: Resultado;
}) {
  return (
    <Bloco titulo="Mercado e custos">
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoDecimal {...f("fipe")} rotulo="FIPE" prefixo="R$" />
        <CampoDecimal
          {...f("vendaProvavel")}
          rotulo="Venda provável"
          prefixo="R$"
          dica="Já com desconto por histórico de leilão"
        />
        <CampoDecimal {...f("vendaRapida")} rotulo="Venda rápida (liquidação)" prefixo="R$" />
        <CampoTexto
          {...f("notasVenda")}
          multilinha
          rotulo="Como cheguei na venda provável"
          className="sm:col-span-3"
        />
      </div>

      <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-700">Custos do lote</h3>
      <p className="mb-2 text-xs text-slate-500">Campo vazio usa o padrão dos Parâmetros (mostrado em cinza).</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {CUSTOS.map(([campo, rotulo]) => {
          const ehPct = campo === "comissaoPct";
          const padrao = ehPct ? formatPct(parametros[campo]) : formatBRL(parametros[campo]);
          return (
            <CampoDecimal
              key={campo}
              {...f(campo)}
              rotulo={rotulo}
              prefixo={ehPct ? undefined : "R$"}
              placeholder={`padrão ${padrao}`}
              dica={lote[campo] !== null ? `padrão: ${padrao}` : undefined}
            />
          );
        })}
      </div>
      <p className="mt-3 text-sm text-slate-700">
        Custos fixos do lote (taxas + transporte + documentação + venda + capital + tributos):{" "}
        <strong>{formatBRL(resultado.custos.fixos)}</strong>
      </p>
    </Bloco>
  );
}
