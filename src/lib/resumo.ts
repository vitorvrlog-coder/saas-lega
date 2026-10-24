import { calcularLote } from "./calc/motor";
import type { LoteCompletoDTO, ParametrosDTO } from "./dominio";

/** Resumo serializável de um lote para listas e painel. */
export function resumirLote(l: LoteCompletoDTO, parametros: ParametrosDTO) {
  const r = calcularLote({ lote: l, itens: l.itens, riscos: l.riscos, parametros });
  return {
    id: l.id,
    nome: l.nome,
    veiculo: [l.marca, l.modelo, l.versao, l.ano].filter(Boolean).join(" "),
    leiloeiro: l.leiloeiro,
    numeroLote: l.numeroLote,
    dataLeilao: l.dataLeilao,
    cidadePatio: l.cidadePatio,
    status: l.status,
    reparoProvavel: r.reparo.provavel.toString(),
    lanceAtual: l.lanceAtual,
    teto: r.teto?.floor().toString() ?? null,
    veredito: r.veredito,
    bloqueios: r.bloqueios.length,
    alertas: r.alertas.length,
    itens: l.itens.length,
  };
}
export type ResumoLote = ReturnType<typeof resumirLote>;
