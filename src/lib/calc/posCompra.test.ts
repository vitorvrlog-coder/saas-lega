import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calcularIndicadores, calcularPosCompra, diasEntre } from "./posCompra";
import type { ItemDTO, LoteCompletoDTO, ParametrosDTO } from "../dominio";

const P: ParametrosDTO = {
  horaOficina: "150",
  lucroMinimo: "15000",
  comissaoPct: "5",
  taxasLeilao: "2000",
  transporte: "2500",
  documentacao: "1500",
  custosVenda: "2000",
  custoCapital: "0",
  tributos: "0",
};

const POS = {
  comissaoPct: null,
  lanceArrematado: "70000",
  dataArremate: "2026-01-10",
  taxasReais: "2100",
  transporteReal: "2400",
  documentacaoReal: "1600",
  outrosGastos: "500",
  precoVenda: "145000",
  dataVenda: "2026-03-01",
  custosVendaReais: "2500",
};

describe("calcularPosCompra", () => {
  it("custo real total, lucro real, desvio e dias", () => {
    const r = calcularPosCompra(POS, [{ custoReal: "9000" }, { custoReal: "2500" }, { custoReal: null }], new Decimal(10650), P);
    expect(r.custoLance.toNumber()).toBe(73500);
    expect(r.custoRealItens.toNumber()).toBe(11500);
    expect(r.custoRealTotal.toNumber()).toBe(91600);
    expect(r.lucroReal!.toNumber()).toBe(50900);
    expect(r.desvioReparoPct!.toFixed(2)).toBe("7.98");
    expect(r.dias).toBe(50);
  });

  it("sem venda: lucro real nulo; sem custo real: desvio nulo", () => {
    const r = calcularPosCompra({ ...POS, precoVenda: null }, [{ custoReal: null }], new Decimal(10000), P);
    expect(r.lucroReal).toBeNull();
    expect(r.desvioReparoPct).toBeNull();
    expect(r.temCustoReal).toBe(false);
  });

  it("custo real zero conta como lançado", () => {
    const r = calcularPosCompra(POS, [{ custoReal: "0" }], new Decimal(1000), P);
    expect(r.desvioReparoPct!.toNumber()).toBe(-100);
  });

  it("diasEntre", () => {
    expect(diasEntre("2026-10-01", "2026-10-24")).toBe(23);
    expect(diasEntre(null, "2026-10-24")).toBeNull();
  });
});

const itemBase: Omit<ItemDTO, "id" | "descricao"> = {
  loteId: "l",
  ordem: 0,
  sistema: "motor",
  situacao: "ausente",
  informacao: "observado",
  quantidade: "1",
  precoOriginal: null,
  precoParalela: "10000",
  precoUsada: null,
  tipoProvavel: null,
  horasMO: null,
  agregados: null,
  fontePreco: null,
  validado: true,
  custoReal: null,
};

function lote(x: Partial<LoteCompletoDTO>): LoteCompletoDTO {
  const nulos = Object.fromEntries(
    ["leiloeiro","numeroLote","link","marca","modelo","versao","ano","motorCambio","km","origem","tipoDano","condicaoEdital","lanceAtual","dataLeilao","cidadePatio","observacoes","motivoDescarte","valorPerdido","docNotas","fipe","vendaRapida","notasVenda","lucroMinimo","comissaoPct","taxasLeilao","transporte","documentacao","custosVenda","custoCapital","tributos","lanceArrematado","dataArremate","taxasReais","transporteReal","documentacaoReal","outrosGastos","precoVenda","dataVenda","custosVendaReais"].map((k) => [k, null]),
  );
  return {
    ...(nulos as object),
    id: "l",
    nome: "Lote",
    status: "avaliando",
    docSituacao: "verificada",
    vendaProvavel: "100000",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    itens: [{ ...itemBase, id: "i", descricao: "Turbina" }],
    riscos: [],
    ...x,
  } as LoteCompletoDTO;
}

describe("calcularIndicadores", () => {
  it("agrega lotes por status", () => {
    const lotes = [
      lote({ status: "triagem" }),
      lote({ status: "avaliando" }),
      // teto = (100000 − 10000 − 8000 − 15000)/1,05 = 63809,52
      lote({ status: "dar_lance" }),
      // bloqueado: não soma teto
      lote({ status: "dar_lance", docSituacao: "pendente" }),
      lote({ status: "arrematado", lanceArrematado: "50000", taxasReais: "1000", itens: [{ ...itemBase, id: "a", descricao: "Turbina", custoReal: "12000" }] }),
      lote({ status: "vendido", lanceArrematado: "40000", precoVenda: "80000", custosVendaReais: "1000", itens: [{ ...itemBase, id: "b", descricao: "Turbina", custoReal: "9000" }] }),
      lote({ status: "descartado" }),
    ];
    const r = calcularIndicadores(lotes, P);
    expect(r.emAvaliacao).toBe(2);
    expect(r.darLance).toBe(2);
    expect(r.somaTetos.toFixed(2)).toBe("63809.52");
    expect(r.capitalInvestido.toNumber()).toBe(52500 + 1000 + 12000);
    // real 21000 vs previsto 20000 → +5%
    expect(r.desvioReparoPct!.toNumber()).toBe(5);
    // 80000 − 1000 − (42000 + 9000)
    expect(r.lucroRealizado.toNumber()).toBe(28000);
  });

  it("sem lotes", () => {
    const r = calcularIndicadores([], P);
    expect(r.desvioReparoPct).toBeNull();
    expect(r.somaTetos.toNumber()).toBe(0);
  });
});
