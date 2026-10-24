import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calcularItem, calcularLote, calcularReparo, calcularRiscos, resolverCustos, type ItemEntrada, type LoteEntrada, type RiscoEntrada } from "./motor";
import type { ParametrosDTO } from "../dominio";

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

const item = (x: Partial<ItemEntrada>): ItemEntrada => ({
  descricao: "Peça",
  situacao: "ausente",
  quantidade: "1",
  precoOriginal: null,
  precoParalela: null,
  precoUsada: null,
  tipoProvavel: null,
  horasMO: null,
  agregados: null,
  validado: false,
  ...x,
});

const ITENS: ItemEntrada[] = [
  item({ descricao: "Turbina", precoOriginal: "15000", precoParalela: "8000", precoUsada: "5000", horasMO: "4", agregados: "300" }),
  item({ descricao: "Farol", situacao: "danificado", quantidade: "2", precoOriginal: "2000", precoUsada: "800", tipoProvavel: "usada", horasMO: "1" }),
  item({ descricao: "Radiador", situacao: "inspecionar", precoParalela: "1200", precoUsada: "600", horasMO: "2", agregados: "100" }),
  item({ descricao: "Capô", situacao: "ok", precoOriginal: "3000", horasMO: "5" }),
];

const RISCOS: RiscoEntrada[] = [
  { nome: "Motor", chancePct: "25", custo: "10000" },
  { nome: "Chicote", chancePct: "10", custo: "5000" },
];

const LOTE: LoteEntrada = {
  status: "avaliando",
  docSituacao: "verificada",
  docNotas: null,
  lanceAtual: null,
  vendaProvavel: "150000",
  vendaRapida: "140000",
  lucroMinimo: null,
  comissaoPct: null,
  taxasLeilao: null,
  transporte: null,
  documentacao: null,
  custosVenda: null,
  custoCapital: null,
  tributos: null,
};

const calc = (lote: Partial<LoteEntrada> = {}, itens = ITENS, riscos = RISCOS) =>
  calcularLote({ lote: { ...LOTE, ...lote }, itens, riscos, parametros: P });

const n = (d: Decimal | null | undefined) => (d == null ? null : d.toNumber());

describe("calcularItem", () => {
  it("escolhe preços por cenário e multiplica pela quantidade", () => {
    const c = calcularItem(ITENS[0], "150");
    expect(n(c.unitEconomico)).toBe(5000);
    expect(n(c.unitProvavel)).toBe(8000);
    expect(c.tipoUsadoProvavel).toBe("paralela");
    expect(n(c.unitConservador)).toBe(15000);
    expect(n(c.maoDeObra)).toBe(600);
    expect(n(c.totalEconomico)).toBe(5900);
    expect(n(c.totalProvavel)).toBe(8900);
    expect(n(c.totalConservador)).toBe(15900);
  });

  it("quantidade multiplica só as peças, não horas nem agregados", () => {
    const c = calcularItem(ITENS[1], "150");
    expect(n(c.pecasProvavel)).toBe(1600); // usada escolhida × 2
    expect(n(c.pecasConservador)).toBe(4000); // original × 2
    expect(n(c.maoDeObra)).toBe(150);
  });

  it("tipo escolhido sem preço cai para paralela, depois original, depois usada", () => {
    expect(calcularItem(item({ tipoProvavel: "usada", precoOriginal: "100", precoParalela: "70" }), "0").tipoUsadoProvavel).toBe("paralela");
    expect(calcularItem(item({ tipoProvavel: "usada", precoOriginal: "100" }), "0").tipoUsadoProvavel).toBe("original");
    expect(calcularItem(item({ precoUsada: "40" }), "0").tipoUsadoProvavel).toBe("usada");
  });

  it("conservador sem original usa o maior preço disponível; preço zero é ignorado", () => {
    const c = calcularItem(item({ precoOriginal: "0", precoParalela: "300", precoUsada: "500" }), "0");
    expect(n(c.unitConservador)).toBe(500);
    expect(n(c.unitEconomico)).toBe(300);
  });

  it("sem preço: marca semPreco e conta só MO e agregados", () => {
    const c = calcularItem(item({ horasMO: "2", agregados: "50" }), "150");
    expect(c.semPreco).toBe(true);
    expect(n(c.totalProvavel)).toBe(350);
  });

  it("aceita frações de hora e quantidade", () => {
    const c = calcularItem(item({ quantidade: "1.5", precoParalela: "100.10", horasMO: "0.5" }), "150");
    expect(c.totalProvavel.toString()).toBe("225.15");
  });
});

describe("calcularReparo", () => {
  it("itens a inspecionar entram só no conservador; OK não entra", () => {
    const r = calcularReparo(ITENS, "150");
    expect(n(r.economico)).toBe(7650);
    expect(n(r.provavel)).toBe(10650);
    expect(n(r.conservador)).toBe(21650);
    expect(n(r.inspecionarConservador)).toBe(1600);
  });
});

describe("calcularRiscos", () => {
  it("esperado = Σ chance × custo; conservador usa custo cheio a partir de 25%", () => {
    const r = calcularRiscos(RISCOS);
    expect(n(r.esperado)).toBe(3000);
    expect(n(r.conservador)).toBe(10500);
  });
  it("chance 24,99% ainda é proporcional", () => {
    expect(n(calcularRiscos([{ nome: "x", chancePct: "24.99", custo: "1000" }]).conservador)).toBeCloseTo(249.9);
  });
});

describe("resolverCustos", () => {
  it("campo vazio usa o padrão; zero explícito no lote vale como zero", () => {
    const c = resolverCustos({ transporte: "0", comissaoPct: "10" }, P);
    expect(n(c.transporte)).toBe(0);
    expect(c.padrao.has("transporte")).toBe(false);
    expect(c.padrao.has("taxasLeilao")).toBe(true);
    expect(n(c.fixos)).toBe(5500);
    expect(n(c.c)).toBe(0.1);
  });
});

describe("calcularLote — lances", () => {
  it("calcula lance econômico, variante com peças baratas e lance ajustado", () => {
    const r = calc();
    expect(n(r.custos.fixos)).toBe(8000);
    expect(r.lanceEconomico!.toFixed(2)).toBe("107952.38"); // 113350 / 1,05
    expect(r.lanceEconomicoPecasBaratas!.toFixed(2)).toBe("110809.52"); // 116350 / 1,05
    expect(r.lanceAjustado!.toFixed(2)).toBe("80809.52"); // (140000 − 21650 − 10500 − 8000 − 15000) / 1,05
    expect(r.teto!.toFixed(2)).toBe("80809.52");
    expect(r.bloqueios).toEqual([]);
    expect(r.veredito).toEqual({ tipo: "ate", texto: expect.stringMatching(/^Até R\$\s?80\.809$/) });
  });

  it("venda rápida vazia: ajustado usa a venda provável e gera alerta", () => {
    const r = calc({ vendaRapida: null });
    expect(r.lanceAjustado!.toFixed(2)).toBe(new Decimal(150000 - 21650 - 10500 - 8000 - 15000).div(1.05).toFixed(2));
    expect(r.alertas.map((a) => a.codigo)).toContain("sem_venda_rapida");
  });

  it("venda rápida maior que a provável: usa a menor", () => {
    expect(n(calc({ vendaRapida: "200000" }).vendaAjustada)).toBe(150000);
  });

  it("alertas de preço não validado e itens a inspecionar não bloqueiam", () => {
    const r = calc();
    expect(r.alertas.map((a) => a.codigo)).toEqual(["nao_validado", "inspecionar"]);
    expect(r.alertas[0].mensagem).toMatch(/^3 preços/);
    expect(r.teto).not.toBeNull();
  });

  it("riscos sem custo geram alerta", () => {
    const r = calc({}, ITENS, [{ nome: "Estrutura", chancePct: "20", custo: null }]);
    expect(r.alertas.find((a) => a.codigo === "risco_sem_custo")?.mensagem).toContain("Estrutura");
  });
});

describe("calcularLote — bloqueios", () => {
  it("documentação pendente bloqueia o teto", () => {
    const r = calc({ docSituacao: "pendente", docNotas: "ver edital" });
    expect(r.teto).toBeNull();
    expect(r.bloqueios[0]).toEqual({ codigo: "doc_pendente", mensagem: "Documentação não verificada: ver edital" });
    expect(r.veredito.tipo).toBe("bloqueado");
    expect(r.lanceAjustado).not.toBeNull(); // a conta continua visível
  });

  it("documentação bloqueada mostra o motivo", () => {
    const r = calc({ docSituacao: "bloqueada", docNotas: "Sinistro com perda total, sem transferência" });
    expect(r.bloqueios[0].mensagem).toBe("Documentação bloqueada: Sinistro com perda total, sem transferência");
  });

  it("falta venda provável bloqueia e o veredito é 'sem preço de venda'", () => {
    const r = calc({ vendaProvavel: null });
    expect(r.bloqueios.map((b) => b.codigo)).toContain("sem_venda");
    expect(r.lanceEconomico).toBeNull();
    expect(r.teto).toBeNull();
    expect(r.veredito).toEqual({ tipo: "sem_venda", texto: "Sem preço de venda" });
  });

  it("item ausente ou danificado sem preço bloqueia; reparar/inspecionar sem preço não", () => {
    const sem = [
      ...ITENS,
      item({ descricao: "Bateria", situacao: "ausente" }),
      item({ descricao: "Para-lama", situacao: "danificado" }),
      item({ descricao: "Porta", situacao: "reparar", horasMO: "3" }),
      item({ descricao: "Chicote", situacao: "inspecionar" }),
    ];
    const r = calc({}, sem);
    const b = r.bloqueios.find((x) => x.codigo === "item_sem_preco")!;
    expect(b.mensagem).toBe("2 itens ausentes/danificados sem preço: Bateria, Para-lama");
    expect(r.teto).toBeNull();
  });

  it("vários bloqueios ao mesmo tempo", () => {
    const r = calc({ docSituacao: "pendente", vendaProvavel: null }, [item({ descricao: "Turbina" })]);
    expect(r.bloqueios.map((b) => b.codigo)).toEqual(["doc_pendente", "sem_venda", "item_sem_preco"]);
  });
});

describe("calcularLote — lance atual e veredito", () => {
  it("lucro projetado, capital e retorno no lance atual", () => {
    const r = calc({ lanceAtual: "70000" });
    expect(n(r.noLanceAtual!.custoLance)).toBe(73500);
    expect(n(r.noLanceAtual!.lucro)).toBe(54850); // 150000 − (73500 + 10650 + 3000 + 8000)
    expect(n(r.noLanceAtual!.capital)).toBe(90150); // 73500 + 10650 + 2000 + 2500 + 1500
    expect(r.noLanceAtual!.retorno!.toFixed(4)).toBe("0.6084");
    expect(r.veredito).toEqual({ tipo: "dentro", texto: "Dentro do limite" });
  });

  it("lance atual acima do teto", () => {
    expect(calc({ lanceAtual: "90000" }).veredito.tipo).toBe("acima");
  });

  it("lance igual ao teto está dentro do limite", () => {
    const teto = calc().teto!.toString();
    expect(calc({ lanceAtual: teto }).veredito.tipo).toBe("dentro");
  });

  it("não vale quando os dois lances são ≤ 0", () => {
    const r = calc({ vendaProvavel: "30000", vendaRapida: "28000" });
    expect(r.veredito).toEqual({ tipo: "nao_vale", texto: "Não vale" });
  });

  it("'não vale' tem prioridade sobre bloqueio", () => {
    expect(calc({ vendaProvavel: "30000", docSituacao: "pendente" }).veredito.tipo).toBe("nao_vale");
  });

  it("ajustado ≤ 0 com econômico positivo: teto zero e 'não vale no cenário de risco'", () => {
    const r = calc({ vendaRapida: "50000" });
    expect(r.lanceEconomico!.gt(0)).toBe(true);
    expect(r.lanceAjustado!.lte(0)).toBe(true);
    expect(n(r.teto)).toBe(0);
    expect(r.veredito.tipo).toBe("nao_vale_risco");
  });

  it("status define o veredito de lotes encerrados", () => {
    expect(calc({ status: "descartado" }).veredito.texto).toBe("Descartado");
    expect(calc({ status: "arrematado" }).veredito.texto).toBe("Arrematado");
    expect(calc({ status: "vendido" }).veredito.texto).toBe("Vendido");
    expect(calc({ status: "perdido" }).veredito.texto).toBe("Perdido");
  });

  it("comissão do lote substitui a dos parâmetros", () => {
    const r = calc({ comissaoPct: "10" });
    expect(r.lanceEconomico!.toFixed(2)).toBe(new Decimal(113350).div(1.1).toFixed(2));
  });

  it("lote vazio (só nome) não quebra e fica sem preço de venda", () => {
    const r = calcularLote({ lote: { ...LOTE, vendaProvavel: null, vendaRapida: null, docSituacao: "pendente" }, itens: [], riscos: [], parametros: P });
    expect(r.veredito.tipo).toBe("sem_venda");
    expect(n(r.reparo.provavel)).toBe(0);
  });
});
