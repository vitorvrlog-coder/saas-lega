/* items.js — itens, inventário, saque por região e receitas (sem THREE). */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;

  // cat: comida, agua, remedio, arma, municao, ferramenta, material, chave, diverso, nota
  const ITEMS = {
    enlatado: { name: 'Comida enlatada', cat: 'comida', w: 0.5, value: 6, food: 35 },
    barra: { name: 'Barra de cereal', cat: 'comida', w: 0.1, value: 3, food: 15 },
    arroz: { name: 'Pacote de arroz', cat: 'comida', w: 1.0, value: 8, food: 45, needsCook: false },
    fruta: { name: 'Frutas da horta', cat: 'comida', w: 0.4, value: 4, food: 20, water: 5 },
    agua: { name: 'Garrafa de água', cat: 'agua', w: 0.6, value: 5, water: 40 },
    refri: { name: 'Refrigerante', cat: 'agua', w: 0.4, value: 3, water: 20, food: 4 },
    bandagem: { name: 'Bandagem', cat: 'remedio', w: 0.1, value: 6, heal: 15, stopsBleed: true },
    kit_medico: { name: 'Kit médico', cat: 'remedio', w: 0.8, value: 25, heal: 55, stopsBleed: true },
    antibiotico: { name: 'Antibiótico', cat: 'remedio', w: 0.1, value: 30, cure: 60 },
    analgesico: { name: 'Analgésico', cat: 'remedio', w: 0.1, value: 8, heal: 8, stamina: 30 },
    faca: { name: 'Faca', cat: 'arma', w: 0.3, value: 10, weapon: { type: 'melee', dmg: 26, range: 1.6, rate: 0.5, noise: 3 } },
    cano: { name: 'Cano de ferro', cat: 'arma', w: 1.5, value: 8, weapon: { type: 'melee', dmg: 34, range: 2.0, rate: 0.85, noise: 4 } },
    taco: { name: 'Taco de beisebol', cat: 'arma', w: 1.0, value: 12, weapon: { type: 'melee', dmg: 38, range: 2.1, rate: 0.8, noise: 4 } },
    machado: { name: 'Machado', cat: 'arma', w: 2.0, value: 22, weapon: { type: 'melee', dmg: 60, range: 2.0, rate: 1.1, noise: 5 } },
    pistola: { name: 'Pistola 9mm', cat: 'arma', w: 1.0, value: 45, weapon: { type: 'gun', dmg: 34, range: 45, rate: 0.35, ammo: 'mun_9mm', mag: 15, spread: 0.035, noise: 35 } },
    espingarda: { name: 'Espingarda', cat: 'arma', w: 3.2, value: 70, weapon: { type: 'gun', dmg: 22, pellets: 7, range: 22, rate: 1.0, ammo: 'mun_12', mag: 6, spread: 0.09, noise: 50 } },
    fuzil: { name: 'Fuzil', cat: 'arma', w: 3.8, value: 110, weapon: { type: 'gun', dmg: 48, range: 90, rate: 0.14, ammo: 'mun_556', mag: 30, spread: 0.02, noise: 60, auto: true } },
    mun_9mm: { name: 'Munição 9mm', cat: 'municao', w: 0.01, value: 1, stack: true },
    mun_12: { name: 'Cartucho calibre 12', cat: 'municao', w: 0.04, value: 2, stack: true },
    mun_556: { name: 'Munição 5.56', cat: 'municao', w: 0.012, value: 2, stack: true },
    pe_de_cabra: { name: 'Pé de cabra', cat: 'ferramenta', w: 1.5, value: 18, tool: 'crowbar', weapon: { type: 'melee', dmg: 30, range: 1.9, rate: 0.8, noise: 4 } },
    kit_ferramentas: { name: 'Kit de ferramentas', cat: 'ferramenta', w: 2.5, value: 30, tool: 'repair' },
    lanterna: { name: 'Lanterna', cat: 'ferramenta', w: 0.3, value: 10, tool: 'light' },
    radio: { name: 'Rádio portátil', cat: 'ferramenta', w: 0.6, value: 20, tool: 'radio' },
    galao: { name: 'Galão de combustível', cat: 'material', w: 5.0, value: 20, fuel: 10 },
    madeira: { name: 'Tábuas de madeira', cat: 'material', w: 1.0, value: 2 },
    metal: { name: 'Sucata de metal', cat: 'material', w: 1.2, value: 3 },
    pregos: { name: 'Caixa de pregos', cat: 'material', w: 0.3, value: 3 },
    tecido: { name: 'Tecido', cat: 'material', w: 0.2, value: 2 },
    pecas: { name: 'Peças mecânicas', cat: 'material', w: 1.5, value: 12 },
    sementes: { name: 'Pacote de sementes', cat: 'material', w: 0.1, value: 10 },
    bateria: { name: 'Baterias', cat: 'material', w: 0.2, value: 4 },
    colete: { name: 'Colete à prova de balas', cat: 'diverso', w: 4.0, value: 60, armor: 0.45 },
    mochila: { name: 'Mochila grande', cat: 'diverso', w: 1.0, value: 25, capacity: 15 },
    chave_arsenal: { name: 'Chave do arsenal da delegacia', cat: 'chave', w: 0.05, value: 40, key: 'chave_arsenal' },
    nota: { name: 'Anotação', cat: 'nota', w: 0.01, value: 0 },
  };

  const LOOT = {
    casa_cozinha: [['enlatado', 30], ['barra', 20], ['agua', 25], ['refri', 15], ['arroz', 10], ['faca', 4], ['nota', 6]],
    casa_quarto: [['tecido', 25], ['lanterna', 8], ['bateria', 12], ['taco', 5], ['pistola', 3], ['mun_9mm', 8], ['nota', 12], ['sementes', 6], ['mochila', 3]],
    casa_banheiro: [['bandagem', 35], ['analgesico', 25], ['antibiotico', 6], ['tecido', 10]],
    casa_geral: [['bateria', 15], ['pregos', 12], ['tecido', 15], ['nota', 15], ['radio', 4], ['mun_9mm', 8], ['barra', 12], ['sementes', 6], ['chave_arsenal', 1.2]],
    hosp_remedios: [['bandagem', 30], ['kit_medico', 18], ['antibiotico', 16], ['analgesico', 22], ['nota', 5]],
    hosp_geral: [['bandagem', 25], ['tecido', 20], ['agua', 15], ['analgesico', 15], ['nota', 8], ['bateria', 6]],
    hosp_farmacia: [['antibiotico', 40], ['kit_medico', 30], ['analgesico', 20]],
    mercado_comida: [['enlatado', 35], ['arroz', 20], ['agua', 30], ['refri', 20], ['barra', 25], ['sementes', 4]],
    mercado_geral: [['bateria', 20], ['lanterna', 8], ['tecido', 15], ['pregos', 10], ['agua', 15], ['radio', 3]],
    policia_armario: [['mun_9mm', 30], ['colete', 6], ['pistola', 10], ['mun_12', 12], ['lanterna', 10], ['radio', 6], ['bandagem', 10]],
    policia_geral: [['nota', 25], ['chave_arsenal', 10], ['mun_9mm', 15], ['barra', 10], ['bateria', 10]],
    policia_arsenal: [['espingarda', 30], ['fuzil', 18], ['mun_12', 35], ['mun_556', 35], ['colete', 20], ['pistola', 20]],
    oficina_ferramentas: [['kit_ferramentas', 18], ['pe_de_cabra', 18], ['pregos', 20], ['metal', 20], ['cano', 12], ['machado', 6]],
    oficina_pecas: [['pecas', 35], ['metal', 25], ['galao', 10], ['bateria', 12]],
    posto_loja: [['barra', 25], ['refri', 25], ['agua', 20], ['enlatado', 10], ['bateria', 10], ['lanterna', 5]],
    posto_combustivel: [['galao', 70], ['pecas', 10]],
    galpao_materiais: [['madeira', 35], ['metal', 25], ['pregos', 20], ['tecido', 10], ['galao', 6]],
    galpao_geral: [['enlatado', 20], ['agua', 20], ['mun_9mm', 10], ['madeira', 15], ['pecas', 10]],
    caixa_suprimentos: [['enlatado', 25], ['agua', 25], ['kit_medico', 10], ['mun_9mm', 15], ['antibiotico', 8], ['galao', 10]],
  };
  const STACK_ROLL = { mun_9mm: [6, 24], mun_12: [3, 10], mun_556: [10, 30], enlatado: [1, 3], agua: [1, 2], barra: [1, 3], madeira: [2, 5], metal: [1, 3], pregos: [1, 2], tecido: [1, 3], bandagem: [1, 3], refri: [1, 2] };

  const NOTES = [
    'Diário de Marta, apto 302: "O rádio parou ontem. Vou esperar o Pedro voltar do mercado. Ele prometeu."',
    'Bilhete na geladeira: "Fomos para a Colina Verde, a leste da cidade. Há comida e uma cerca. Venha!"',
    'Relatório policial: "Arsenal trancado por ordem do delegado. Chave com o plantonista."',
    'Anotação médica: "Antibióticos retardam a infecção da mordida. Não curam se for tarde demais."',
    'Lista de compras: "arroz, pilhas, água. NÃO SAIR À NOITE."',
    'Carta não enviada: "Se alguém ler isto, os Corvos ficam no galpão a oeste. Não negociem com eles."',
    'Caderno do mecânico: "A picape da oficina precisa de peças e de um galão para rodar."',
    'Mensagem riscada na parede: "Eles ouvem os tiros. Usem facas."',
    'Recado: "Bianca, se você voltar ao posto, eu fui buscar peças no supermercado. — Ana"',
    'Folheto do aeroporto: "Hangar 2 — caça de demonstração abastecido para o show aéreo de sábado."',
    'Página de diário: "Vi um avião passando ontem ao norte. Ainda tem gente lá fora."',
    'Bilhete infantil: "Mamãe foi pro hospital. Disse que volta logo."',
  ];

  function rollLoot(table, rng, count) {
    const t = LOOT[table] || LOOT.casa_geral;
    const total = t.reduce((s, e) => s + e[1], 0);
    const items = [];
    for (let i = 0; i < count; i++) {
      let r = rng() * total;
      for (const [id, wt] of t) {
        r -= wt;
        if (r <= 0) {
          const roll = STACK_ROLL[id];
          const qty = roll ? roll[0] + Math.floor(rng() * (roll[1] - roll[0] + 1)) : 1;
          const it = { id, qty };
          if (id === 'nota') it.text = NOTES[Math.floor(rng() * NOTES.length)];
          addTo(items, it);
          break;
        }
      }
    }
    return items;
  }

  // lista simples de pilhas {id, qty, text?, ammo?}
  function addTo(list, it) {
    const def = ITEMS[it.id];
    const same = list.find((e) => e.id === it.id && !e.text && !it.text && (def.stack || def.cat !== 'arma'));
    if (same) same.qty += it.qty; else list.push(Object.assign({}, it));
    return list;
  }
  function removeFrom(list, id, qty) {
    let left = qty;
    for (let i = list.length - 1; i >= 0 && left > 0; i--) {
      if (list[i].id !== id) continue;
      const take = Math.min(left, list[i].qty);
      list[i].qty -= take; left -= take;
      if (list[i].qty <= 0) list.splice(i, 1);
    }
    return qty - left;
  }
  const count = (list, id) => list.reduce((s, e) => s + (e.id === id ? e.qty : 0), 0);
  const weight = (list) => list.reduce((s, e) => s + ITEMS[e.id].w * e.qty, 0);
  const value = (list) => list.reduce((s, e) => s + ITEMS[e.id].value * e.qty, 0);

  class Inventory {
    constructor(capacity) { this.items = []; this.capacity = capacity || 25; }
    add(id, qty, extra) { addTo(this.items, Object.assign({ id, qty: qty || 1 }, extra || {})); }
    remove(id, qty) { return removeFrom(this.items, id, qty || 1); }
    count(id) { return count(this.items, id); }
    has(id, qty) { return this.count(id) >= (qty || 1); }
    weight() { return weight(this.items); }
    overweight() { return this.weight() > this.capacity; }
    hasTool(tool) { return this.items.some((e) => ITEMS[e.id].tool === tool); }
    serialize() { return { items: this.items.map((e) => Object.assign({}, e)), capacity: this.capacity }; }
    load(d) { this.items = (d.items || []).filter((e) => ITEMS[e.id]); this.capacity = d.capacity || 25; }
  }

  // Receitas (criação de itens e estruturas)
  const RECIPES = [
    { id: 'bandagem', name: 'Bandagem', needs: { tecido: 2 }, gives: { bandagem: 1 } },
    { id: 'cano', name: 'Cano de ferro (arma)', needs: { metal: 2 }, gives: { cano: 1 } },
    { id: 'machado', name: 'Machado improvisado', needs: { metal: 2, madeira: 2 }, gives: { machado: 1 }, tool: 'repair' },
    { id: 'mun_12', name: 'Recarga de cartuchos (×4)', needs: { metal: 1, pregos: 1 }, gives: { mun_12: 4 }, tool: 'repair' },
  ];
  // Estruturas da base: custo e efeito
  const STRUCTURES = {
    barricada: { name: 'Barricada', needs: { madeira: 4, pregos: 1 }, size: [3, 0.5, 1.4], blocks: true },
    muro: { name: 'Muro de metal', needs: { metal: 4, pregos: 2 }, size: [4, 0.4, 2.4], blocks: true },
    armadilha: { name: 'Armadilha de pregos', needs: { madeira: 1, pregos: 2 }, size: [1.5, 1.5, 0.2], trap: true },
    deposito: { name: 'Depósito', needs: { madeira: 4, metal: 1 }, size: [1.6, 0.8, 1.8], storage: 60 },
    enfermaria: { name: 'Enfermaria', needs: { madeira: 3, tecido: 4, bandagem: 2 }, size: [2.2, 1.0, 0.7], med: true },
    oficina: { name: 'Bancada de oficina', needs: { madeira: 3, metal: 3, kit_ferramentas: 1 }, size: [2.0, 0.9, 1.0], workshop: true },
    horta: { name: 'Horta', needs: { madeira: 2, sementes: 2 }, size: [4, 3, 0.3], farm: true, walk: true },
    tanque: { name: 'Tanque de água', needs: { metal: 3, madeira: 1 }, size: [1.5, 1.5, 2.0], water: true },
    gerador: { name: 'Gerador', needs: { metal: 3, pecas: 2 }, size: [1.4, 1.0, 1.2], power: true },
    torre: { name: 'Torre de vigia', needs: { madeira: 6, pregos: 2 }, size: [2, 2, 4], watch: true },
  };

  FS.Items = { ITEMS, LOOT, NOTES, rollLoot, addTo, removeFrom, count, weight, value, Inventory, RECIPES, STRUCTURES };
})(typeof window !== 'undefined' ? window : globalThis);
