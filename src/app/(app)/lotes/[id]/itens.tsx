"use client";

import { useState, useTransition } from "react";
import { CampoBool, CampoDecimal, CampoSelect, CampoTexto } from "@/components/campos";
import { Bloco, Botao } from "@/components/ui";
import { useRastrear } from "@/components/salvamento";
import { adicionarItem, aplicarKit, puxarMenorPreco, removerItem, salvarItemComoCotacao } from "@/lib/actions/lotes";
import { calcularItem, calcularReparo, dec } from "@/lib/calc/motor";
import {
  INFORMACAO,
  SISTEMA,
  SITUACAO_ITEM,
  TIPO_PECA,
  type ItemDTO,
  type LoteDTO,
  type ParametrosDTO,
} from "@/lib/dominio";
import { formatBRL, hojeISO } from "@/lib/format";

const COR_SITUACAO: Record<ItemDTO["situacao"], string> = {
  ausente: "border-l-red-500",
  danificado: "border-l-orange-500",
  reparar: "border-l-amber-400",
  inspecionar: "border-l-sky-500",
  ok: "border-l-emerald-500",
};

export function BlocoItens({
  lote,
  itens,
  setItens,
  parametros,
  kits,
  mostrarCustoReal,
}: {
  lote: LoteDTO;
  itens: ItemDTO[];
  setItens: React.Dispatch<React.SetStateAction<ItemDTO[]>>;
  parametros: ParametrosDTO;
  kits: { id: string; nome: string }[];
  mostrarCustoReal: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const rastrear = useRastrear();
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const atualizar = (id: string, campo: keyof ItemDTO) => (v: unknown) =>
    setItens((xs) => xs.map((i) => (i.id === id ? { ...i, [campo]: v } : i)));

  const novo = () =>
    iniciar(async () => {
      const i = await rastrear(adicionarItem(lote.id));
      setItens((xs) => [...xs, i]);
    });

  const kit = (k: { id: string; nome: string }) =>
    iniciar(async () => {
      const r = await rastrear(aplicarKit(lote.id, k.id));
      setItens((xs) => [...xs, ...r.novos]);
      setMsg({
        tipo: "ok",
        texto: `Kit "${k.nome}": ${r.novos.length} ${r.novos.length === 1 ? "item adicionado" : "itens adicionados"}${r.ignorados ? `, ${r.ignorados} já existiam` : ""}.`,
      });
    });

  const remover = (i: ItemDTO) => {
    if (!confirm(`Remover "${i.descricao}"?`)) return;
    setItens((xs) => xs.filter((x) => x.id !== i.id));
    iniciar(() => rastrear(removerItem(i.id)));
  };

  const puxar = (i: ItemDTO) =>
    iniciar(async () => {
      const r = await rastrear(puxarMenorPreco(i.id));
      if (r.ok) {
        setItens((xs) => xs.map((x) => (x.id === i.id ? { ...x, ...r.item } : x)));
        setMsg(r.aviso ? { tipo: "erro", texto: r.aviso } : { tipo: "ok", texto: `Preços de "${i.descricao}" atualizados pela tabela de peças.` });
      } else setMsg({ tipo: "erro", texto: r.erro });
    });

  const salvarCotacao = (i: ItemDTO) => {
    const fornecedor = prompt(`Fornecedor da cotação de "${i.descricao}":`, i.fontePreco ?? "");
    if (fornecedor === null) return;
    iniciar(async () => {
      const r = await rastrear(salvarItemComoCotacao(i.id, fornecedor, hojeISO()));
      setMsg(r.ok ? { tipo: "ok", texto: `${r.criadas} ${r.criadas === 1 ? "cotação salva" : "cotações salvas"} na tabela de peças.` } : { tipo: "erro", texto: r.erro });
    });
  };

  const reparo = calcularReparo(itens, parametros.horaOficina);
  const totalReal = itens.reduce((a, i) => (i.custoReal ? a.plus(dec(i.custoReal)) : a), dec("0"));

  return (
    <Bloco
      titulo={`Peças e reparos (${itens.length})`}
      acoes={
        <Botao variante="primario" onClick={novo} disabled={pendente}>
          + Item
        </Botao>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Kits de dano:</span>
        {kits.map((k) => (
          <Botao key={k.id} onClick={() => kit(k)} disabled={pendente} className="text-xs">
            + {k.nome}
          </Botao>
        ))}
      </div>
      {msg && (
        <p className={`mb-2 rounded px-2 py-1 text-sm ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {msg.texto}{" "}
          <button className="ml-2 text-xs underline" onClick={() => setMsg(null)}>
            fechar
          </button>
        </p>
      )}

      <div className="tabela-rolavel -mx-4 px-4">
        <table className="w-full min-w-[1500px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="p-1">Sistema</th>
              <th className="p-1">Peça/serviço</th>
              <th className="p-1">Situação</th>
              <th className="p-1">Informação</th>
              <th className="p-1">Qtd</th>
              <th className="p-1">Original (un.)</th>
              <th className="p-1">Paralela (un.)</th>
              <th className="p-1">Usada (un.)</th>
              <th className="p-1">Usar no provável</th>
              <th className="p-1">Horas MO</th>
              <th className="p-1">Agregados</th>
              <th className="p-1">Fonte do preço</th>
              <th className="p-1">Validado</th>
              <th className="p-1 text-right">Total provável</th>
              {mostrarCustoReal && <th className="p-1">Custo real</th>}
              <th className="p-1">Ações</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => {
              const c = calcularItem(i, parametros.horaOficina);
              const faltaPreco = (i.situacao === "ausente" || i.situacao === "danificado") && c.semPreco;
              const p = (campo: keyof ItemDTO) => ({ entidade: "item" as const, id: i.id, campo, onChange: atualizar(i.id, campo) });
              const precoCls = `min-w-28 ${faltaPreco ? "[&_input]:bg-red-50" : ""}`;
              return (
                <tr key={i.id} className={`border-t border-slate-100 align-top`}>
                  <td className={`border-l-4 p-1 ${COR_SITUACAO[i.situacao]}`}>
                    <CampoSelect {...p("sistema")} valor={i.sistema} opcoes={SISTEMA} className="min-w-36" />
                  </td>
                  <td className="p-1">
                    <CampoTexto {...p("descricao")} valor={i.descricao} className="min-w-52" />
                  </td>
                  <td className="p-1">
                    <CampoSelect {...p("situacao")} valor={i.situacao} opcoes={SITUACAO_ITEM} className="min-w-32" />
                  </td>
                  <td className="p-1">
                    <CampoSelect {...p("informacao")} valor={i.informacao} opcoes={INFORMACAO} className="min-w-28" />
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("quantidade")} valor={i.quantidade} casas={0} className="min-w-16" />
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("precoOriginal")} valor={i.precoOriginal} className={precoCls} />
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("precoParalela")} valor={i.precoParalela} className={precoCls} />
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("precoUsada")} valor={i.precoUsada} className={precoCls} />
                  </td>
                  <td className="p-1">
                    <CampoSelect {...p("tipoProvavel")} valor={i.tipoProvavel} opcoes={TIPO_PECA} vazio="Automático" className="min-w-32" />
                    {c.tipoUsadoProvavel && !i.tipoProvavel && (
                      <span className="text-[11px] text-slate-500">→ {TIPO_PECA[c.tipoUsadoProvavel]}</span>
                    )}
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("horasMO")} valor={i.horasMO} casas={0} className="min-w-20" />
                  </td>
                  <td className="p-1">
                    <CampoDecimal {...p("agregados")} valor={i.agregados} className="min-w-24" />
                  </td>
                  <td className="p-1">
                    <CampoTexto {...p("fontePreco")} valor={i.fontePreco} className="min-w-48" />
                  </td>
                  <td className="p-1 text-center">
                    <CampoBool {...p("validado")} valor={i.validado} />
                  </td>
                  <td className="p-1 text-right tabular-nums whitespace-nowrap">
                    {!c.conta ? (
                      <span className="text-slate-400">—</span>
                    ) : c.inspecionar ? (
                      <span className="text-sky-700" title="Itens a inspecionar entram só no cenário conservador">
                        {formatBRL(c.totalConservador)}
                        <br />
                        <span className="text-[11px]">só conservador</span>
                      </span>
                    ) : (
                      <>
                        {formatBRL(c.totalProvavel)}
                        {faltaPreco && (
                          <>
                            <br />
                            <span className="text-[11px] text-red-600">sem preço</span>
                          </>
                        )}
                      </>
                    )}
                  </td>
                  {mostrarCustoReal && (
                    <td className="p-1">
                      <CampoDecimal {...p("custoReal")} valor={i.custoReal} className="min-w-28" />
                    </td>
                  )}
                  <td className="p-1 whitespace-nowrap">
                    <Botao variante="link" className="text-xs" title="Puxar menor preço da tabela de peças" onClick={() => puxar(i)} disabled={pendente}>
                      menor preço
                    </Botao>
                    <Botao variante="link" className="text-xs" title="Salvar os preços desta linha como cotação" onClick={() => salvarCotacao(i)} disabled={pendente}>
                      salvar cotação
                    </Botao>
                    <Botao variante="link" className="text-xs text-red-600" onClick={() => remover(i)}>
                      remover
                    </Botao>
                  </td>
                </tr>
              );
            })}
            {itens.length === 0 && (
              <tr>
                <td colSpan={16} className="p-4 text-center text-slate-500">
                  Nenhum item. Use “+ Item” ou um kit de dano.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 text-sm">
            <tr>
              <td colSpan={13} className="p-1 text-right text-slate-600">
                Peças (provável) {formatBRL(reparo.pecasProvavel)} + mão de obra {formatBRL(reparo.maoDeObra)} + agregados{" "}
                {formatBRL(reparo.agregados)} = <strong>reparo provável</strong>
              </td>
              <td className="p-1 text-right font-semibold tabular-nums whitespace-nowrap">{formatBRL(reparo.provavel)}</td>
              {mostrarCustoReal && (
                <td className="p-1 font-semibold tabular-nums whitespace-nowrap">Real: {formatBRL(totalReal)}</td>
              )}
              <td />
            </tr>
            <tr className="text-slate-600">
              <td colSpan={13} className="p-1 text-right">Reparo econômico (menor preço de cada peça)</td>
              <td className="p-1 text-right tabular-nums whitespace-nowrap">{formatBRL(reparo.economico)}</td>
            </tr>
            <tr className="text-slate-600">
              <td colSpan={13} className="p-1 text-right">
                Reparo conservador (original + itens a inspecionar {formatBRL(reparo.inspecionarConservador)})
              </td>
              <td className="p-1 text-right tabular-nums whitespace-nowrap">{formatBRL(reparo.conservador)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Preços são unitários (multiplicados pela quantidade). Horas e agregados são do item inteiro. Hora de oficina:{" "}
        {formatBRL(parametros.horaOficina)}.
      </p>
    </Bloco>
  );
}
