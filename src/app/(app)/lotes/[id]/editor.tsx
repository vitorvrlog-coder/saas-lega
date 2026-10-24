"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CampoData, CampoDecimal, CampoInteiro, CampoSelect, CampoTexto } from "@/components/campos";
import { Bloco, Botao } from "@/components/ui";
import { apagarLote } from "@/lib/actions/lotes";
import { calcularLote } from "@/lib/calc/motor";
import {
  ORIGEM,
  SITUACAO_DOC,
  STATUS,
  posCompraAtivo,
  type ItemDTO,
  type LoteCompletoDTO,
  type LoteDTO,
  type ParametrosDTO,
  type RiscoDTO,
} from "@/lib/dominio";
import { BlocoItens } from "./itens";
import { BlocoRiscos } from "./riscos";
import { BlocoMercado } from "./mercado";
import { BlocoResultado } from "./resultado";
import { BlocoPosCompra } from "./pos-compra";

export type CampoLoteProps = <K extends keyof LoteDTO>(
  campo: K,
) => { entidade: "lote"; id: string; campo: K; valor: LoteDTO[K]; onChange: (v: LoteDTO[K] | null) => void };

export function EditorLote({
  inicial,
  parametros,
  kits,
}: {
  inicial: LoteCompletoDTO;
  parametros: ParametrosDTO;
  kits: { id: string; nome: string }[];
}) {
  const { itens: itensIniciais, riscos: riscosIniciais, ...loteInicial } = inicial;
  const [lote, setLote] = useState<LoteDTO>(loteInicial);
  const [itens, setItens] = useState<ItemDTO[]>(itensIniciais);
  const [riscos, setRiscos] = useState<RiscoDTO[]>(riscosIniciais);
  const [, iniciar] = useTransition();

  const resultado = useMemo(() => calcularLote({ lote, itens, riscos, parametros }), [lote, itens, riscos, parametros]);

  const f: CampoLoteProps = (campo) => ({
    entidade: "lote",
    id: lote.id,
    campo,
    valor: lote[campo],
    onChange: (v) => setLote((l) => ({ ...l, [campo]: v })),
  });

  const pos = posCompraAtivo(lote.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/lotes" className="text-sm text-sky-700">
          ← Lotes
        </Link>
        <h1 className="w-full text-lg font-semibold sm:w-auto sm:text-xl">{lote.nome}</h1>
      </div>

      <Bloco>
        <div className="grid gap-3 sm:grid-cols-3">
          <CampoSelect {...f("status")} opcoes={STATUS} rotulo="Status" />
          {lote.status === "descartado" && (
            <CampoTexto {...f("motivoDescarte")} rotulo="Motivo do descarte" className="sm:col-span-2" />
          )}
          {lote.status === "perdido" && (
            <CampoDecimal {...f("valorPerdido")} rotulo="Arrematado por outro por" prefixo="R$" />
          )}
        </div>
      </Bloco>

      <BlocoResultado resultado={resultado} lote={lote} />

      <Bloco titulo="Dados do lote">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CampoTexto {...f("nome")} rotulo="Nome" className="sm:col-span-2 lg:col-span-4" />
          <CampoTexto {...f("leiloeiro")} rotulo="Leiloeiro" />
          <CampoTexto {...f("numeroLote")} rotulo="Nº do lote" />
          <CampoTexto {...f("link")} rotulo="Link" className="sm:col-span-2" />
          <CampoTexto {...f("marca")} rotulo="Marca" />
          <CampoTexto {...f("modelo")} rotulo="Modelo" dica="Usado para buscar cotações" />
          <CampoTexto {...f("versao")} rotulo="Versão" />
          <CampoInteiro {...f("ano")} rotulo="Ano" />
          <CampoTexto {...f("motorCambio")} rotulo="Motor/câmbio" />
          <CampoInteiro {...f("km")} rotulo="Km" />
          <CampoSelect {...f("origem")} opcoes={ORIGEM} vazio="A preencher" rotulo="Origem" />
          <CampoTexto {...f("tipoDano")} rotulo="Tipo de dano" />
          <CampoTexto {...f("condicaoEdital")} rotulo="Condição no edital" className="sm:col-span-2" />
          <CampoDecimal {...f("lanceAtual")} rotulo="Lance atual" prefixo="R$" />
          <CampoData {...f("dataLeilao")} rotulo="Data do leilão" />
          <CampoTexto {...f("cidadePatio")} rotulo="Cidade do pátio" />
          <CampoTexto {...f("observacoes")} rotulo="Observações" multilinha className="sm:col-span-2 lg:col-span-4" />
        </div>
        {lote.link && (
          <a href={lote.link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-sky-700 hover:underline">
            Abrir anúncio do lote ↗
          </a>
        )}
      </Bloco>

      <Bloco titulo="Documentação">
        <div className="grid gap-3 sm:grid-cols-4">
          <CampoSelect {...f("docSituacao")} opcoes={SITUACAO_DOC} rotulo="Situação" />
          <CampoTexto
            {...f("docNotas")}
            multilinha
            rotulo={lote.docSituacao === "bloqueada" ? "Motivo do bloqueio" : "O que falta verificar"}
            className="sm:col-span-3"
          />
        </div>
      </Bloco>

      <BlocoItens
        lote={lote}
        itens={itens}
        setItens={setItens}
        parametros={parametros}
        kits={kits}
        mostrarCustoReal={pos}
      />

      <BlocoRiscos loteId={lote.id} riscos={riscos} setRiscos={setRiscos} />

      <BlocoMercado f={f} lote={lote} parametros={parametros} resultado={resultado} />

      {pos && <BlocoPosCompra f={f} lote={lote} itens={itens} parametros={parametros} resultado={resultado} />}

      <div className="pt-4 text-right">
        <Botao
          variante="perigo"
          onClick={() => confirm(`Apagar o lote "${lote.nome}" com todos os itens e riscos?`) && iniciar(() => apagarLote(lote.id))}
        >
          Apagar lote
        </Botao>
      </div>
    </div>
  );
}
