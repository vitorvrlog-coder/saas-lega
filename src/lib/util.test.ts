import { describe, expect, it } from "vitest";
import { parseDecimalBR, decimalParaInput, normalizar } from "./format";
import { idsMenorPreco, menoresParaPeca } from "./cotacoes";
import { itensNovosDoKit } from "./kits";
import type { CotacaoDTO } from "./dominio";

describe("parseDecimalBR", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["R$ 15.000", "15000"],
    ["15.000,00", "15000"],
    ["150", "150"],
    ["1234.5", "1234.5"],
    ["0,5", "0.5"],
    ["", null],
    ["abc", null],
    ["1,2,3", null],
  ])("%s → %s", (e, s) => expect(parseDecimalBR(e)).toBe(s));

  it("ida e volta", () => expect(decimalParaInput("1234.5")).toBe("1.234,50"));
});

const cot = (x: Partial<CotacaoDTO>): CotacaoDTO => ({
  id: Math.random().toString(),
  peca: "Turbina",
  modelo: "Hilux",
  tipo: "paralela",
  preco: "100",
  fornecedor: "A",
  link: null,
  data: "2026-10-01",
  observacao: null,
  createdAt: "2026-10-01",
  ...x,
});

describe("cotações", () => {
  it("menor preço por peça + modelo + tipo, sem diferenciar acento/maiúsculas", () => {
    const cs = [
      cot({ id: "1", preco: "8500" }),
      cot({ id: "2", peca: "TURBINA ", preco: "7900" }),
      cot({ id: "3", tipo: "original", preco: "15000" }),
      cot({ id: "4", modelo: "SW4", preco: "100" }),
    ];
    expect([...idsMenorPreco(cs)].sort()).toEqual(["2", "3", "4"]);
  });

  it("menoresParaPeca prefere o modelo do lote e cai para qualquer modelo", () => {
    const cs = [cot({ id: "a", preco: "900" }), cot({ id: "b", modelo: "SW4", preco: "500" }), cot({ id: "c", tipo: "usada", modelo: "SW4", preco: "300" })];
    const m = menoresParaPeca(cs, "turbina", "hilux")!;
    expect(m.mesmoModelo).toBe(true);
    expect(m.porTipo.paralela?.id).toBe("a");
    expect(m.porTipo.usada).toBeUndefined();
    const outro = menoresParaPeca(cs, "Turbina", "Ranger")!;
    expect(outro.mesmoModelo).toBe(false);
    expect(outro.porTipo.paralela?.id).toBe("b");
    expect(outro.porTipo.usada?.id).toBe("c");
    expect(menoresParaPeca(cs, "Radiador", "Hilux")).toBeNull();
  });
});

describe("kits", () => {
  it("não duplica itens já existentes nem repetidos no kit", () => {
    const novos = itensNovosDoKit(["Radiador", "condensador do a/c"], [
      { descricao: "Radiador" },
      { descricao: "Condensador do A/C" },
      { descricao: "Ventoinha" },
      { descricao: "ventoínha" },
    ]);
    expect(novos.map((i) => i.descricao)).toEqual(["Ventoinha"]);
  });
  it("normalizar", () => expect(normalizar("  Capô   Dianteiro ")).toBe("capo dianteiro"));
});
