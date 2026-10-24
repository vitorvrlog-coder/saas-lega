"use client";

import { useMemo, useState, useTransition } from "react";
import { Bloco, Botao, Selo } from "@/components/ui";
import { apagarCotacao, criarCotacao, type NovaCotacao } from "@/lib/actions/cotacoes";
import { idsMenorPreco } from "@/lib/cotacoes";
import { TIPO_PECA, type CotacaoDTO, type TipoPeca } from "@/lib/dominio";
import { formatBRL, formatData, hojeISO, normalizar, parseDecimalBR } from "@/lib/format";

const inp = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

function vazia(): Omit<NovaCotacao, "preco"> & { preco: string } {
  return { peca: "", modelo: "", tipo: "paralela", preco: "", fornecedor: "", link: "", data: hojeISO(), observacao: "" };
}

export function TabelaPecas({ cotacoes }: { cotacoes: CotacaoDTO[] }) {
  const [nova, setNova] = useState(vazia);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const [filtro, setFiltro] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoPeca | "">("");
  const [soMenores, setSoMenores] = useState(false);

  const menores = useMemo(() => idsMenorPreco(cotacoes), [cotacoes]);
  const lista = useMemo(() => {
    const f = normalizar(filtro);
    return cotacoes.filter(
      (c) =>
        (!f || normalizar(`${c.peca} ${c.modelo ?? ""} ${c.fornecedor}`).includes(f)) &&
        (!filtroTipo || c.tipo === filtroTipo) &&
        (!soMenores || menores.has(c.id)),
    );
  }, [cotacoes, filtro, filtroTipo, soMenores, menores]);

  const set = (k: keyof NovaCotacao) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setNova((n) => ({ ...n, [k]: e.target.value }));

  const salvar = (e: React.FormEvent) => {
    e.preventDefault();
    iniciar(async () => {
      const r = await criarCotacao({ ...nova, preco: parseDecimalBR(nova.preco) });
      if (r.ok) {
        setErro(null);
        // Mantém fornecedor, modelo e data para cadastrar várias peças em sequência.
        setNova((n) => ({ ...vazia(), fornecedor: n.fornecedor, modelo: n.modelo, data: n.data, tipo: n.tipo }));
      } else setErro(r.erro);
    });
  };

  return (
    <>
      <Bloco titulo="Nova cotação">
        <form onSubmit={salvar} className="grid gap-2 sm:grid-cols-4">
          <input className={inp} placeholder="Peça *" value={nova.peca} onChange={set("peca")} />
          <input className={inp} placeholder="Modelo (ex.: Hilux)" value={nova.modelo} onChange={set("modelo")} />
          <select className={inp} value={nova.tipo} onChange={set("tipo")}>
            {Object.entries(TIPO_PECA).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </select>
          <input className={inp} placeholder="Preço (R$) *" inputMode="decimal" value={nova.preco} onChange={set("preco")} />
          <input className={inp} placeholder="Fornecedor *" value={nova.fornecedor} onChange={set("fornecedor")} />
          <input className={inp} placeholder="Link" value={nova.link} onChange={set("link")} />
          <input className={inp} type="date" value={nova.data} onChange={set("data")} />
          <input className={inp} placeholder="Observação" value={nova.observacao} onChange={set("observacao")} />
          <div className="flex items-center gap-3 sm:col-span-4">
            <Botao variante="primario" disabled={pendente}>
              Adicionar cotação
            </Botao>
            {erro && <span className="text-sm text-red-600">{erro}</span>}
          </div>
        </form>
      </Bloco>

      <Bloco
        titulo={`Cotações (${lista.length})`}
        acoes={
          <>
            <input className={`${inp} w-48`} placeholder="Filtrar peça, modelo, fornecedor" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            <select className={`${inp} w-32`} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoPeca | "")}>
              <option value="">Todos os tipos</option>
              {Object.entries(TIPO_PECA).map(([k, r]) => (
                <option key={k} value={k}>
                  {r}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={soMenores} onChange={(e) => setSoMenores(e.target.checked)} /> Só menores preços
            </label>
          </>
        }
      >
        <div className="tabela-rolavel">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="p-2">Peça</th>
                <th className="p-2">Modelo</th>
                <th className="p-2">Tipo</th>
                <th className="p-2 text-right">Preço</th>
                <th className="p-2">Fornecedor</th>
                <th className="p-2">Data</th>
                <th className="p-2">Observação</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const menor = menores.has(c.id);
                return (
                  <tr key={c.id} className={`border-t border-slate-100 ${menor ? "bg-emerald-50" : ""}`}>
                    <td className="p-2">
                      {c.link ? (
                        <a href={c.link} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                          {c.peca}
                        </a>
                      ) : (
                        c.peca
                      )}
                    </td>
                    <td className="p-2">{c.modelo}</td>
                    <td className="p-2">{TIPO_PECA[c.tipo]}</td>
                    <td className="p-2 text-right tabular-nums whitespace-nowrap">
                      {formatBRL(c.preco)} {menor && <Selo cor="verde">menor</Selo>}
                    </td>
                    <td className="p-2">{c.fornecedor}</td>
                    <td className="p-2 whitespace-nowrap">{formatData(c.data)}</td>
                    <td className="p-2 text-slate-600">{c.observacao}</td>
                    <td className="p-2 text-right">
                      <Botao
                        variante="link"
                        className="text-red-600"
                        title="Apagar (só para corrigir erro de digitação)"
                        onClick={() => confirm("Apagar esta cotação? Use só para corrigir erro de digitação.") && iniciar(() => apagarCotacao(c.id))}
                      >
                        apagar
                      </Botao>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-slate-500">
                    Nenhuma cotação.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Bloco>
    </>
  );
}
