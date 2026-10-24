"use client";

import { CampoDecimal } from "@/components/campos";
import { Bloco } from "@/components/ui";
import type { ParametrosDTO } from "@/lib/dominio";

const CAMPOS: [keyof ParametrosDTO, string, string?][] = [
  ["horaOficina", "Hora de oficina", "R$"],
  ["lucroMinimo", "Lucro mínimo por lote", "R$"],
  ["comissaoPct", "Comissão do leiloeiro (%)", "%"],
  ["taxasLeilao", "Taxas do leilão", "R$"],
  ["transporte", "Transporte", "R$"],
  ["documentacao", "Documentação", "R$"],
  ["custosVenda", "Custos de venda", "R$"],
  ["custoCapital", "Custo do capital", "R$"],
  ["tributos", "Tributos", "R$"],
];

export function FormParametros({ p }: { p: ParametrosDTO }) {
  return (
    <Bloco>
      <div className="grid gap-3 sm:grid-cols-2">
        {CAMPOS.map(([campo, rotulo, prefixo]) => (
          <CampoDecimal
            key={campo}
            entidade="parametros"
            id="1"
            campo={campo}
            valor={p[campo]}
            rotulo={rotulo}
            prefixo={prefixo === "R$" ? "R$" : undefined}
          />
        ))}
      </div>
    </Bloco>
  );
}
