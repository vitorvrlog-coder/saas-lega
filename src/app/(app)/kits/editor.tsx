"use client";

import { useState, useTransition } from "react";
import { CampoDecimal, CampoSelect, CampoTexto } from "@/components/campos";
import { Bloco, Botao } from "@/components/ui";
import { useRastrear } from "@/components/salvamento";
import { adicionarItemKit, apagarKit, criarKit, removerItemKit } from "@/lib/actions/kits";
import { SISTEMA, type Sistema } from "@/lib/dominio";

type Item = { id: string; kitId: string; ordem: number; sistema: Sistema; descricao: string; quantidade: string };
type Kit = { id: string; nome: string; ordem: number; itens: Item[] };

function KitEditor({ kit }: { kit: Kit }) {
  const [itens, setItens] = useState(kit.itens);
  const [pendente, iniciar] = useTransition();
  const rastrear = useRastrear();
  return (
    <Bloco
      titulo={<CampoTexto entidade="kit" id={kit.id} campo="nome" valor={kit.nome} className="min-w-64 font-semibold" />}
      acoes={
        <>
          <Botao
            disabled={pendente}
            onClick={() =>
              iniciar(async () => {
                const i = await rastrear(adicionarItemKit(kit.id));
                setItens((xs) => [...xs, i]);
              })
            }
          >
            + Item
          </Botao>
          <Botao variante="perigo" onClick={() => confirm(`Apagar o kit "${kit.nome}"?`) && iniciar(() => apagarKit(kit.id))}>
            Apagar kit
          </Botao>
        </>
      }
    >
      <div className="tabela-rolavel">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="p-1">Sistema</th>
              <th className="p-1">Peça/serviço</th>
              <th className="p-1">Qtd</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="p-1">
                  <CampoSelect entidade="kitItem" id={i.id} campo="sistema" valor={i.sistema} opcoes={SISTEMA} className="min-w-40" />
                </td>
                <td className="p-1">
                  <CampoTexto entidade="kitItem" id={i.id} campo="descricao" valor={i.descricao} />
                </td>
                <td className="p-1">
                  <CampoDecimal entidade="kitItem" id={i.id} campo="quantidade" valor={i.quantidade} casas={0} className="min-w-16" />
                </td>
                <td className="p-1 text-right">
                  <Botao
                    variante="link"
                    className="text-xs text-red-600"
                    onClick={() => {
                      setItens((xs) => xs.filter((x) => x.id !== i.id));
                      iniciar(() => rastrear(removerItemKit(i.id)));
                    }}
                  >
                    remover
                  </Botao>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}

export function EditorKits({ kits }: { kits: Kit[] }) {
  const [pendente, iniciar] = useTransition();
  return (
    <div className="space-y-4">
      {kits.map((k) => (
        <KitEditor key={k.id} kit={k} />
      ))}
      <Botao variante="primario" disabled={pendente} onClick={() => iniciar(() => criarKit())}>
        + Novo kit
      </Botao>
    </div>
  );
}
