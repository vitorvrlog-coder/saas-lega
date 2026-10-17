/* sim.js — simulação do mundo vivo (sem THREE):
 * zumbis e sobreviventes com IA (percepção, navegação, necessidades, rotinas),
 * facções, recursos, relações sociais, confiança, missões, eventos dinâmicos e a base do jogador.
 * Agentes perto do jogador têm simulação detalhada; os distantes, simplificada. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const TW = FS.Town;
  const IT = FS.Items;

  const DETAIL_R = 140;     // raio de simulação detalhada
  const ZOMBIE_CAP = 34;

  /* ============================================================ dados iniciais */
  const B = TW.byId;
  const roomPoint = (bid, floor, rng) => TW.randomRoomPoint(B[bid], rng, floor);

  const FACTIONS = [
    { id: 'colina', name: 'Comunidade Colina Verde', desc: 'Agricultores pacíficos atrás de uma cerca a leste da vila.', color: '#7bd88f', hostile: false,
      base: { x: TW.camp.x0 + 36, z: TW.camp.z0 + 30, r: 45 }, res: { food: 40, water: 30, meds: 4, ammo: 20, fuel: 1 }, rep: 10 },
    { id: 'mercadores', name: 'Mercadores do Posto', desc: 'Comerciantes que controlam o Posto Estrela e a estrada.', color: '#ffc857', hostile: false,
      base: { x: B.posto.x0 + 6, z: B.posto.z0 - 14, r: 35 }, res: { food: 25, water: 25, meds: 6, ammo: 80, fuel: 12 }, rep: 0 },
    { id: 'clinica', name: 'Clínica São Lucas', desc: 'Comunidade médica que trata feridos no hospital.', color: '#7ec8ff', hostile: false,
      base: { x: (B.hosp.x0 + B.hosp.x1) / 2, z: (B.hosp.z0 + B.hosp.z1) / 2, r: 30, bid: 'hosp' }, res: { food: 15, water: 20, meds: 25, ammo: 10, fuel: 2 }, rep: 5 },
    { id: 'corvos', name: 'Os Corvos', desc: 'Saqueadores armados entrincheirados no galpão a oeste.', color: '#ff5f5f', hostile: true,
      base: { x: (B.galpao.x0 + B.galpao.x1) / 2, z: (B.galpao.z0 + B.galpao.z1) / 2, r: 35, bid: 'galpao' }, res: { food: 30, water: 20, meds: 5, ammo: 120, fuel: 6 }, rep: -40 },
  ];

  // Sobreviventes (todos adultos). spec: especialização (sem relação com gênero).
  const ROSTER = [
    { id: 'helena', name: 'Helena Prado', g: 'f', age: 52, spec: 'lider', faction: 'colina', role: 'lider', traits: { brave: 0.7, gen: 0.8, loyal: 0.9, social: 0.8 },
      look: { skin: 0.55, hair: 0x9a9a9a, hairLen: 1, top: 0x4f7a4a, bottom: 0x3a3a3a, build: 1.0 },
      bio: 'Era diretora de escola. Organizou a Colina Verde quando a cidade caiu.', weapon: 'pistola', ammo: 20,
      quest: { type: 'fetch', item: 'galao', qty: 2, title: 'Combustível para o gerador', desc: 'O gerador da Colina está quase sem combustível. Traga 2 galões.', faction: true, rep: 20, trust: 15, reward: { kit_medico: 1, enlatado: 3 } } },
    { id: 'tomas', name: 'Tomás Reis', g: 'm', age: 34, spec: 'agricultor', faction: 'colina', role: 'agricultor', traits: { brave: 0.4, gen: 0.7, loyal: 0.8, social: 0.6 },
      look: { skin: 0.35, hair: 0x2a1a10, hairLen: 0, top: 0x9b6b3a, bottom: 0x2f4a6a, build: 1.05 },
      bio: 'Plantava hortaliças para a feira. Hoje alimenta a comunidade inteira.', weapon: 'faca' },
    { id: 'lucia', name: 'Lúcia Santos', g: 'f', age: 29, spec: 'agricultora', faction: 'colina', role: 'agricultor', traits: { brave: 0.5, gen: 0.8, loyal: 0.7, social: 0.9 },
      look: { skin: 0.3, hair: 0x1a0f08, hairLen: 2, top: 0xc0504d, bottom: 0x3d5a40, build: 0.92 },
      bio: 'Bióloga. Cuida das sementes e da horta da Colina.', weapon: 'faca',
      quest: { type: 'fetch', item: 'sementes', qty: 2, title: 'Sementes novas', desc: 'Preciso de 2 pacotes de sementes para ampliar a horta. Casas e o mercado podem ter.', rep: 12, trust: 20, reward: { fruta: 4, agua: 2 } } },
    { id: 'rafael', name: 'Rafael Mendes', g: 'm', age: 45, spec: 'comerciante', faction: 'mercadores', role: 'comerciante', traits: { brave: 0.5, gen: 0.3, loyal: 0.6, social: 0.9 },
      look: { skin: 0.6, hair: 0x3a2a1a, hairLen: 0, top: 0x2d4f7c, bottom: 0x5a4a3a, build: 1.1 },
      bio: 'Dono do posto antes de tudo. Troca qualquer coisa por qualquer coisa.', weapon: 'espingarda', ammo: 12, trader: true,
      quest: { type: 'fetch', item: 'pecas', qty: 3, title: 'Peças para o caminhão', desc: 'Traga 3 peças mecânicas. A oficina do Zé deve ter.', faction: true, rep: 18, trust: 10, reward: { mun_9mm: 30, agua: 3 } } },
    { id: 'bianca', name: 'Bianca Lopes', g: 'f', age: 31, spec: 'mecanica', faction: 'mercadores', role: 'mecanico', traits: { brave: 0.75, gen: 0.6, loyal: 0.8, social: 0.6 },
      look: { skin: 0.45, hair: 0x5a2a12, hairLen: 1, top: 0x6f6f6f, bottom: 0x24364f, build: 0.97 },
      bio: 'Mecânica de aviões no aeroporto. Conserta carros, geradores e aeronaves.', weapon: 'cano',
      quest: { type: 'rescue', target: 'ana', title: 'Encontre a Ana', desc: 'Minha amiga Ana foi buscar peças no supermercado e não voltou. Traga-a de volta ao posto.', rep: 15, trust: 30, reward: { kit_ferramentas: 1 } } },
    { id: 'marina', name: 'Dra. Marina Costa', g: 'f', age: 41, spec: 'medica', faction: 'clinica', role: 'medico', traits: { brave: 0.6, gen: 0.9, loyal: 0.8, social: 0.7 },
      look: { skin: 0.4, hair: 0x2a1a12, hairLen: 1, top: 0xeaeaea, bottom: 0x6a8aa8, build: 0.95 },
      bio: 'Cirurgiã do Hospital São Lucas. Nunca deixou de atender quem chega.', weapon: 'pistola', ammo: 12,
      quest: { type: 'fetch', item: 'kit_medico', qty: 2, title: 'Suprimentos médicos', desc: 'Estamos sem kits médicos. Traga 2 e eu trato você de graça sempre que precisar.', faction: true, rep: 25, trust: 20, reward: { antibiotico: 2 } } },
    { id: 'paulo', name: 'Paulo Andrade', g: 'm', age: 26, spec: 'comum', faction: 'clinica', role: 'explorador', traits: { brave: 0.55, gen: 0.7, loyal: 0.6, social: 0.8 },
      look: { skin: 0.7, hair: 0x101010, hairLen: 0, top: 0x3f8f7f, bottom: 0x303030, build: 1.0 },
      bio: 'Estudante de enfermagem. Aprende rápido e quer ser útil.', weapon: 'taco' },
    { id: 'diego', name: 'Diego "Corvo" Farias', g: 'm', age: 38, spec: 'atirador', faction: 'corvos', role: 'lider', traits: { brave: 0.9, gen: 0.1, loyal: 0.4, social: 0.4 },
      look: { skin: 0.5, hair: 0x050505, hairLen: 0, top: 0x1a1a1a, bottom: 0x3a3020, build: 1.15 },
      bio: 'Ex-segurança. Acredita que só os fortes sobrevivem.', weapon: 'fuzil', ammo: 60 },
    { id: 'katia', name: 'Kátia Ramos', g: 'f', age: 33, spec: 'atiradora', faction: 'corvos', role: 'guarda', traits: { brave: 0.85, gen: 0.4, loyal: 0.35, social: 0.4 },
      look: { skin: 0.5, hair: 0x6a1a1a, hairLen: 1, top: 0x3a2a2a, bottom: 0x2a2a2a, build: 1.0 },
      bio: 'Atiradora de elite do clube de tiro. Começa a duvidar dos métodos do Diego.', weapon: 'fuzil', ammo: 45,
      quest: { type: 'fetch', item: 'antibiotico', qty: 1, title: 'Saída dos Corvos', desc: 'Me arranja um antibiótico sem o Diego saber e eu considero deixar os Corvos.', trust: 35, reward: { mun_556: 20 }, defect: true } },
    { id: 'bruno', name: 'Bruno Teles', g: 'm', age: 27, spec: 'explorador', faction: 'corvos', role: 'explorador', traits: { brave: 0.6, gen: 0.3, loyal: 0.5, social: 0.5 },
      look: { skin: 0.25, hair: 0x6a4a2a, hairLen: 0, top: 0x4a5a3a, bottom: 0x2a2a3a, build: 1.0 },
      bio: 'Corre mais rápido que qualquer zumbi. Faz o que mandam.', weapon: 'pistola', ammo: 15 },
    { id: 'sofia', name: 'Sofia Almeida', g: 'f', age: 24, spec: 'exploradora', faction: null, role: 'solitario', traits: { brave: 0.65, gen: 0.6, loyal: 0.75, social: 0.5 },
      look: { skin: 0.35, hair: 0xc8a050, hairLen: 2, top: 0x5a3f7a, bottom: 0x2a3a5a, build: 0.9 },
      bio: 'Corredora de parkour. Conhece todos os telhados da cidade.', weapon: 'faca', home: { bid: 'aurora', floor: 3 },
      quest: { type: 'clear', bid: 'aurora', kills: 4, title: 'Limpe o Edifício Aurora', desc: 'Há zumbis nos andares do Aurora. Elimine 4 deles e eu viajo com você.', trust: 35, reward: { radio: 1 } } },
    { id: 'carlos', name: 'Carlos Nunes', g: 'm', age: 60, spec: 'engenheiro', faction: null, role: 'solitario', traits: { brave: 0.3, gen: 0.7, loyal: 0.85, social: 0.6 },
      look: { skin: 0.5, hair: 0xdddddd, hairLen: 0, top: 0x7a6a5a, bottom: 0x4a4a4a, build: 1.05 },
      bio: 'Engenheiro aposentado. Está ferido e escondido no Sobrado Verde.', weapon: null, home: { bid: 'casaE', floor: 1 }, hurt: true,
      quest: { type: 'fetch', item: 'antibiotico', qty: 1, title: 'Remédio para a ferida', desc: 'Minha perna infeccionou. Um antibiótico salvaria minha vida.', trust: 45, reward: { pecas: 2 } } },
    { id: 'ana', name: 'Ana Ferreira', g: 'f', age: 36, spec: 'engenheira', faction: 'mercadores', role: 'mecanico', traits: { brave: 0.5, gen: 0.7, loyal: 0.8, social: 0.6 },
      look: { skin: 0.65, hair: 0x2a1a0a, hairLen: 2, top: 0xb07a3a, bottom: 0x3a3a3a, build: 0.95 },
      bio: 'Engenheira elétrica. Mantém os geradores funcionando.', weapon: 'cano', missing: { bid: 'mercado', floor: 0 } },
    { id: 'jorge', name: 'Jorge Lima', g: 'm', age: 48, spec: 'atirador', faction: null, role: 'solitario', traits: { brave: 0.8, gen: 0.5, loyal: 0.7, social: 0.4 },
      look: { skin: 0.45, hair: 0x3a3a3a, hairLen: 0, top: 0x2a3a5a, bottom: 0x2a2a3a, build: 1.1 },
      bio: 'Ex-policial. Guarda a delegacia sozinho e não confia em ninguém.', weapon: 'pistola', ammo: 18, home: { bid: 'policia', floor: 0 },
      quest: { type: 'fetch', item: 'chave_arsenal', qty: 1, title: 'A chave do arsenal', desc: 'Perdi a chave do arsenal. Deve estar em alguma gaveta da delegacia ou numa casa. Ache e dividimos as armas.', trust: 40, reward: { mun_9mm: 20 } } },
  ];
  // relações iniciais entre sobreviventes (afinidade)
  const BONDS = [['tomas', 'lucia', 92, 'partner'], ['helena', 'marina', 70], ['bianca', 'ana', 85], ['sofia', 'paulo', 60], ['diego', 'rafael', -60], ['katia', 'diego', 10], ['jorge', 'diego', -70], ['carlos', 'helena', 40]];

  const SPEC_NAME = { lider: 'Líder', agricultor: 'Agricultor', agricultora: 'Agricultora', comerciante: 'Comerciante', mecanica: 'Mecânica', mecanico: 'Mecânico', medica: 'Médica', medico: 'Médico', comum: 'Sobrevivente', atirador: 'Atirador', atiradora: 'Atiradora', explorador: 'Explorador', exploradora: 'Exploradora', engenheiro: 'Engenheiro', engenheira: 'Engenheira' };
  const SKILL_OF = { lider: 'lead', agricultor: 'farm', agricultora: 'farm', comerciante: 'trade', mecanica: 'mech', mecanico: 'mech', medica: 'med', medico: 'med', atirador: 'shoot', atiradora: 'shoot', explorador: 'scav', exploradora: 'scav', engenheiro: 'mech', engenheira: 'mech', comum: null };

  /* ================================================================ agentes */
  let idSeq = 1;
  function makeAgent(kind, x, y, z) {
    return { uid: idSeq++, kind, x, y, z, yaw: Math.random() * 6.28, vx: 0, vz: 0, hp: 100, maxHp: 100, alive: true, radius: 0.32,
      path: null, pi: 0, goal: null, repathT: 0, state: 'idle', stateT: 0, target: null, attackT: 0, perceiveT: Math.random() * 0.3,
      moving: 0, action: null, actionT: 0, active: true, speed: 0, stuckT: 0, lastPos: [x, z] };
  }

  const Sim = {
    t: 8,                 // horas desde o início (dia 0, 08:00)
    rng: M.mulberry32(1234),
    agents: [], npcs: {}, zombies: [], factions: {}, log: [], quests: [], noises: [], crates: [],
    base: null, player: null, cb: {}, pathBudget: 0, killsByBuilding: {}, flags: {},
    dayLength: 24 * 60,   // segundos reais por dia de jogo

    init(player, callbacks) {
      this.player = player;
      this.cb = callbacks || {};
      this.agents = []; this.npcs = {}; this.zombies = []; this.log = []; this.quests = []; this.noises = []; this.crates = [];
      this.factions = {};
      this.t = 8; this.lastHour = 8; this.killsByBuilding = {}; this.flags = {};
      FACTIONS.forEach((f) => { this.factions[f.id] = Object.assign({ members: [], morale: 70, relations: {}, alive: true }, JSON.parse(JSON.stringify(f))); });
      const fr = this.factions;
      fr.colina.relations = { mercadores: 40, clinica: 50, corvos: -60 };
      fr.mercadores.relations = { colina: 40, clinica: 30, corvos: -20 };
      fr.clinica.relations = { colina: 50, mercadores: 30, corvos: -40 };
      fr.corvos.relations = { colina: -60, mercadores: -20, clinica: -40 };
      ROSTER.forEach((r) => this.spawnNpc(r));
      BONDS.forEach(([a, b, v, kind]) => { const A = this.npcs[a], Bn = this.npcs[b]; A.rel[b] = v; Bn.rel[a] = v; if (kind === 'partner') { A.partner = b; Bn.partner = a; } });
      this.base = { claimed: false, bid: null, x: 0, z: 0, structures: [], storage: new IT.Inventory(400), residents: [], jobs: {}, defense: 0, morale: 70, power: false };
      // população inicial de zumbis
      for (let i = 0; i < 26; i++) this.spawnZombie(null);
      this.addLog('Você acordou na Casa Amarela, na Vila Esperança. O rádio só chia.', 'info');
    },

    hour() { return ((this.t % 24) + 24) % 24; },
    day() { return Math.floor(this.t / 24) + 1; },
    daylight() { const h = this.hour(); return M.smoothstep(5, 7.5, h) * (1 - M.smoothstep(18, 20, h)); },
    clock() { const h = this.hour(); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return 'Dia ' + this.day() + ' · ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); },
    addLog(text, kind) { this.log.unshift({ t: this.t, time: this.clock(), text, kind: kind || 'info' }); if (this.log.length > 80) this.log.pop(); if (this.cb.onLog) this.cb.onLog(text, kind); },

    /* ---------------------------------------------------------------- criação */
    spawnNpc(r) {
      const rng = this.rng;
      let p = null;
      if (r.missing) p = roomPoint(r.missing.bid, r.missing.floor, rng);
      else if (r.home) p = roomPoint(r.home.bid, r.home.floor, rng);
      else if (r.faction) {
        const f = this.factions[r.faction];
        if (f.base.bid) p = roomPoint(f.base.bid, 0, rng);
        if (!p) p = this.freePointNear(f.base.x, f.base.z, 10);
      }
      if (!p) p = TW.randomStreetPoint(rng);
      const a = makeAgent('npc', p.x, p.y, p.z);
      const skills = { med: 0.1, mech: 0.1, shoot: 0.2, scav: 0.2, farm: 0.1, trade: 0.1, lead: 0.1 };
      const sk = SKILL_OF[r.spec];
      if (sk) skills[sk] = 0.8;
      if (r.weapon === 'fuzil' || r.weapon === 'espingarda') skills.shoot = Math.max(skills.shoot, 0.6);
      Object.assign(a, {
        id: r.id, name: r.name, g: r.g, age: r.age, spec: r.spec, specName: SPEC_NAME[r.spec] || r.spec, faction: r.faction, role: r.role,
        traits: Object.assign({}, r.traits), skills, look: r.look, bio: r.bio, trader: !!r.trader,
        inv: new IT.Inventory(30), weapon: r.weapon || null, food: 70 + rng() * 30, water: 70 + rng() * 30, energy: 60 + rng() * 40,
        trust: r.faction === 'corvos' ? -30 : r.faction ? 10 : 0, affinity: 0, met: false, memory: [], rel: {}, partner: null,
        companion: false, order: null, orderPos: null, home: { x: p.x, y: p.y, z: p.z }, homeBid: (r.home && r.home.bid) || (r.missing ? null : (r.faction && this.factions[r.faction].base.bid) || null),
        questDef: r.quest || null, missing: !!r.missing, hurt: !!r.hurt, job: null, chatT: 0, sayT: 0, decideT: rng() * 2, voice: { pitch: r.g === 'f' ? 1.15 + rng() * 0.2 : 0.8 + rng() * 0.2, rate: 1 + (rng() - 0.5) * 0.15 },
        speedWalk: 1.5, speedRun: 4.6, hostile: r.faction === 'corvos', leftFaction: false,
      });
      if (a.hurt) a.hp = 35;
      if (r.weapon) a.inv.add(r.weapon, 1);
      const w = r.weapon && IT.ITEMS[r.weapon].weapon;
      if (w && w.ammo) { a.inv.add(w.ammo, r.ammo || 10); a.mag = Math.min(w.mag, r.ammo || 10); a.inv.remove(w.ammo, a.mag); }
      a.inv.add('enlatado', 1 + Math.floor(rng() * 2)); a.inv.add('agua', 1);
      if (r.spec === 'medica' || r.spec === 'medico') a.inv.add('bandagem', 4), a.inv.add('kit_medico', 1);
      if (r.trader) { a.inv.add('mun_9mm', 60); a.inv.add('mun_12', 20); a.inv.add('enlatado', 6); a.inv.add('agua', 6); a.inv.add('bandagem', 5); a.inv.add('galao', 3); a.inv.add('pistola', 1); a.inv.add('pecas', 1); a.inv.add('lanterna', 2); a.capital = 200; }
      if (r.missing) a.state = 'trapped';
      this.agents.push(a);
      this.npcs[a.id] = a;
      if (a.faction) this.factions[a.faction].members.push(a.id);
      return a;
    },

    freePointNear(x, z, r) {
      for (let i = 0; i < 20; i++) {
        const px = x + (this.rng() - 0.5) * 2 * r, pz = z + (this.rng() - 0.5) * 2 * r;
        const n = TW.nodeAt(TW.NAV.levels[0], px, pz);
        if (n >= 0 && TW.passable(n, false)) return { x: px, y: TW.ELEV, z: pz };
      }
      return { x, y: TW.ELEV, z };
    },

    spawnZombie(pos, opts) {
      if (this.zombies.filter((z) => z.alive).length >= ZOMBIE_CAP && !(opts && opts.force)) return null;
      const rng = this.rng;
      let p = pos;
      if (!p) {
        // em salas de prédios (muitos andares) ou nas ruas, longe do jogador
        for (let tries = 0; tries < 10 && !p; tries++) {
          let q;
          if (rng() < 0.6) { const b = TW.buildings[Math.floor(rng() * TW.buildings.length)]; if (b.faction && b.id !== 'mercado') continue; q = TW.randomRoomPoint(b, rng); }
          else q = TW.randomStreetPoint(rng);
          if (!q) continue;
          if (this.player && Math.hypot(q.x - this.player.x, q.z - this.player.z) < 25) continue;
          if (this.inFactionBase(q.x, q.z)) continue;
          p = q;
        }
      }
      if (!p) return null;
      const a = makeAgent('zombie', p.x, p.y, p.z);
      const runner = rng() < 0.18;
      Object.assign(a, { hp: 70 + rng() * 50, speedWalk: 0.7 + rng() * 0.4, speedRun: runner ? 4.3 : 2.6 + rng() * 0.7, runner,
        look: { skin: 0.2 + rng() * 0.5, hair: [0x2a1a10, 0x5a4a3a, 0x1a1a1a, 0x8a7a5a][Math.floor(rng() * 4)], hairLen: rng() < 0.4 ? 1 : 0, top: [0x5a4a3a, 0x3a4a5a, 0x6a3a3a, 0x4a5a4a, 0x7a7a6a][Math.floor(rng() * 5)], bottom: [0x2a2a2a, 0x3a3a4a, 0x4a3a2a][Math.floor(rng() * 3)], build: 0.9 + rng() * 0.25 },
        bid: TW.buildingAt(p.x, p.z) ? TW.buildingAt(p.x, p.z).id : null });
      a.maxHp = a.hp;
      this.agents.push(a); this.zombies.push(a);
      return a;
    },

    inFactionBase(x, z) {
      for (const id in this.factions) { const f = this.factions[id]; if (f.alive && Math.hypot(x - f.base.x, z - f.base.z) < f.base.r) return f; }
      return null;
    },

    /* ---------------------------------------------------------------- ruído */
    noise(x, y, z, radius, source) {
      this.noises.push({ x, y, z, r: radius, t: 0.6, source });
    },

    /* ---------------------------------------------------------- movimento */
    requestPath(a, tx, ty, tz) {
      a.goal = { x: tx, y: ty, z: tz };
      if (this.pathBudget <= 0) { a.repathT = 0.2 + Math.random() * 0.3; return; }
      this.pathBudget--;
      const canOpen = a.kind === 'npc';
      const p = TW.findPath(a.x, a.y, a.z, tx, ty, tz, canOpen, a.kind === 'zombie' ? 5000 : 9000);
      a.path = p; a.pi = p && p.length > 1 ? 1 : 0;
      a.repathT = a.kind === 'zombie' ? 0.8 + Math.random() * 0.5 : 2 + Math.random();
      if (!p) a.path = [{ x: tx, y: ty, z: tz, direct: true }], a.pi = 0;
    },

    moveAgent(a, dt, speed) {
      if (!a.path || a.pi >= a.path.length) { a.moving = 0; return true; }
      const w = a.path[a.pi];
      const dx = w.x - a.x, dz = w.z - a.z, dist = Math.hypot(dx, dz);
      if (dist < 0.45 && Math.abs(a.y - w.y) < 1.2 || (w.direct && dist < 0.8)) { a.pi++; return a.pi >= a.path.length; }
      const sp = Math.min(speed, dist / Math.max(dt, 1e-3));
      let mx = dx / Math.max(dist, 1e-6), mz = dz / Math.max(dist, 1e-6);
      // separação simples entre agentes próximos
      if (this.frameAgents) {
        for (const o of this.frameAgents) {
          if (o === a || !o.alive) continue;
          const ox = a.x - o.x, oz = a.z - o.z, d2 = ox * ox + oz * oz;
          if (d2 < 0.5 && d2 > 1e-6 && Math.abs(o.y - a.y) < 1.5) { const d = Math.sqrt(d2); mx += (ox / d) * 0.6; mz += (oz / d) * 0.6; }
        }
      }
      const ml = Math.hypot(mx, mz) || 1;
      let nx = a.x + (mx / ml) * sp * dt, nz = a.z + (mz / ml) * sp * dt;
      // portas: NPCs abrem, zumbis forçam
      this.handleDoors(a, nx, nz, dt);
      [nx, nz] = TW.collideCircle(nx, nz, a.y, a.radius, 1.7);
      const g = TW.groundAt(nx, nz, a.y);
      a.y = g > a.y - 0.7 ? g : a.y - 9.8 * dt * 0.6;
      if (a.y < g) a.y = g;
      const moved = Math.hypot(nx - a.x, nz - a.z);
      a.x = nx; a.z = nz;
      a.yaw = Math.atan2(mx, mz);
      a.moving = moved / Math.max(dt, 1e-3);
      // detecção de travamento
      a.stuckT = moved < sp * dt * 0.25 ? a.stuckT + dt : 0;
      if (a.stuckT > 1.2) { a.stuckT = 0; a.repathT = 0; if (a.goal) this.requestPath(a, a.goal.x, a.goal.y, a.goal.z); }
      return false;
    },

    handleDoors(a, nx, nz, dt) {
      for (const d of TW.doors) {
        if (d.open) continue;
        const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
        if (Math.abs(a.y - d.y0) > 1.5) continue;
        if (Math.hypot(nx - cx, nz - cz) > 1.25) continue;
        if (a.kind === 'npc') { if (!d.locked) { d.open = true; this.cb.onDoor && this.cb.onDoor(d); } }
        else {
          d.bash = (d.bash || 0) + dt;
          if (d.bash > 8 && !d.locked) { d.open = true; d.broken = true; this.cb.onDoor && this.cb.onDoor(d); this.noise(cx, d.y0, cz, 20, 'door'); }
          else if (Math.random() < dt * 0.8) this.noise(cx, d.y0, cz, 12, 'bang');
        }
      }
    },

    /* --------------------------------------------------------- percepção */
    canSee(a, t, range) {
      const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(t.y - a.y) > 6) return false;
      if (d > 2.5) {
        const ang = Math.atan2(dx, dz) - a.yaw;
        const da = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)));
        if (da > 1.15) return false;
      }
      return TW.losClear(a.x, a.y + 1.55, a.z, t.x, t.y + 1.3, t.z);
    },

    visionRange(a, t) {
      const day = this.daylight();
      let r = a.kind === 'zombie' ? M.lerp(9, 22, day) : M.lerp(14, 38, day);
      if (t === this.player) {
        if (this.player.crouch) r *= 0.55;
        if (this.player.flashlight && day < 0.4) r = Math.max(r, 30);
      }
      return r;
    },

    /* ------------------------------------------------------------ dano */
    damage(target, amount, source) {
      if (!target.alive) return;
      if (target === this.player) { this.cb.onPlayerHit && this.cb.onPlayerHit(amount, source); return; }
      target.hp -= amount;
      target.hitT = 0.25;
      if (target.kind === 'npc') {
        if (source === this.player) this.npcAttackedByPlayer(target, amount);
        else if (source && source.kind === 'npc') this.adjustRel(target, source.id, -20);
        if (target.state !== 'fight' && target.state !== 'flee') target.alertT = 5;
      }
      if (target.hp <= 0) this.kill(target, source);
      else if (target.kind === 'zombie' && source) { target.target = source; target.state = 'chase'; }
    },

    kill(a, source) {
      a.alive = false; a.hp = 0; a.state = 'dead'; a.deadT = 0;
      if (a.kind === 'zombie') {
        if (source === this.player) {
          this.player.kills = (this.player.kills || 0) + 1;
          if (a.bid) this.killsByBuilding[a.bid] = (this.killsByBuilding[a.bid] || 0) + 1;
          // ajudar uma comunidade atacada
          const f = this.inFactionBase(a.x, a.z);
          if (f && !f.hostile) this.changeRep(f.id, 2);
        }
        this.cb.onDeath && this.cb.onDeath(a);
        return;
      }
      // NPC morreu
      this.addLog(a.name + ' morreu' + (source === this.player ? ' pelas suas mãos.' : source && source.kind === 'zombie' ? ' atacado por zumbis.' : '.'), 'death');
      const f = a.faction && this.factions[a.faction];
      if (f) {
        f.members = f.members.filter((m) => m !== a.id);
        f.morale -= 15;
        if (source === this.player) this.changeRep(f.id, f.hostile ? -5 : -50);
        if (!f.members.length) { f.alive = false; this.addLog(f.name + ' deixou de existir.', 'faction'); }
      }
      // amigos e parceiros reagem
      for (const id in this.npcs) {
        const o = this.npcs[id];
        if (!o.alive || o === a) continue;
        const aff = o.rel[a.id] || 0;
        if (aff > 40) {
          o.grief = 1;
          if (source === this.player) this.adjustTrust(o, -Math.round(aff * 0.8), 'Você matou ' + a.name + '.');
          else if (o.companion && aff > 60) this.say(o, a.partner === o.id ? 'Não... ' + a.name.split(' ')[0] + '! Não pode ser.' : 'Perdemos ' + a.name.split(' ')[0] + '...', 4);
        }
        if (o.partner === a.id) o.partner = null;
      }
      if (a.companion) { a.companion = false; this.addLog('Seu companheiro ' + a.name + ' caiu em combate.', 'death'); }
      if (this.base) this.base.residents = this.base.residents.filter((r) => r !== a.id);
      this.cb.onDeath && this.cb.onDeath(a);
    },

    npcAttackedByPlayer(n, amount) {
      this.adjustTrust(n, -40, 'Você me atacou!');
      if (n.faction) {
        this.changeRep(n.faction, -25);
        for (const id of this.factions[n.faction].members) { const o = this.npcs[id]; if (o && o.alive) { o.alertT = 8; o.angryAtPlayer = true; } }
      }
      n.angryAtPlayer = true;
    },

    adjustTrust(n, d, why) {
      n.trust = M.clamp(n.trust + d, -100, 100);
      if (why) { n.memory.unshift({ t: this.t, text: why, d }); if (n.memory.length > 12) n.memory.pop(); }
      if (n.companion && n.trust < -10) this.leaveCompanion(n, 'Não confio mais em você. Vou seguir meu caminho.');
    },
    adjustRel(n, otherId, d) { n.rel[otherId] = M.clamp((n.rel[otherId] || 0) + d, -100, 100); },
    changeRep(fid, d) {
      const f = this.factions[fid];
      if (!f) return;
      const before = f.rep;
      f.rep = M.clamp(f.rep + d, -100, 100);
      if (before > -30 && f.rep <= -30 && !f.hostile) this.addLog(f.name + ' agora considera você um inimigo.', 'faction');
      if (before < 40 && f.rep >= 40) this.addLog(f.name + ' agora considera você um aliado.', 'faction');
    },
    hostileToPlayer(n) {
      if (n.companion) return false;
      if (n.angryAtPlayer && n.trust < 0) return true;
      const f = n.faction && this.factions[n.faction];
      if (f && f.hostile && !n.leftFaction) { if (f.rep >= 20) return false; return f.rep < -60 || (this.trespassT || 0) > 8 || !!n.raiding; }
      if (f && f.rep <= -30) return true;
      return false;
    },

    say(n, text, dur) {
      n.bubble = text; n.bubbleT = dur || 3.5;
      this.cb.onSay && this.cb.onSay(n, text);
    },

    /* ======================================================== atualização */
    update(dt) {
      const P = this.player;
      this.t += dt / (this.dayLength / 24);
      this.pathBudget = 2;
      this.frameAgents = this.agents.filter((a) => a.alive && a.active && Math.abs(a.x - P.x) < 60 && Math.abs(a.z - P.z) < 60);
      // território dos Corvos: aviso e depois hostilidade
      const cor = this.factions.corvos;
      if (cor && cor.alive && cor.rep < 20 && Math.hypot(P.x - cor.base.x, P.z - cor.base.z) < cor.base.r + 10 && !P.dead) {
        if (!this.trespassT) {
          const g = cor.members.map((id) => this.npcs[id]).filter((m) => m && m.alive).sort((a, b) => a.distP - b.distP)[0];
          if (g) this.say(g, 'Último aviso! Saia do nosso território!', 4);
          this.addLog('Você entrou no território dos Corvos.', 'faction');
        }
        this.trespassT = (this.trespassT || 0) + dt;
      } else if (this.trespassT) this.trespassT = Math.max(0, this.trespassT - dt * 0.5);
      for (let i = this.noises.length - 1; i >= 0; i--) { this.noises[i].t -= dt; if (this.noises[i].t <= 0) this.noises.splice(i, 1); }
      for (const a of this.agents) {
        if (!a.alive) { a.deadT = (a.deadT || 0) + dt; continue; }
        const dist = Math.hypot(a.x - P.x, a.z - P.z);
        a.active = dist < DETAIL_R;
        a.distP = dist;
        if (a.bubbleT) { a.bubbleT -= dt; if (a.bubbleT <= 0) a.bubble = null; }
        if (a.hitT) a.hitT = Math.max(0, a.hitT - dt);
        if (a.kind === 'zombie') this.updateZombie(a, dt);
        else this.updateNpc(a, dt);
      }
      // remove cadáveres antigos e zumbis muito distantes; repõe população
      this.agents = this.agents.filter((a) => {
        if (!a.alive && a.deadT > 60) { this.cb.onRemove && this.cb.onRemove(a); return false; }
        if (a.kind === 'zombie' && a.alive && a.distP > 220 && !a.horde) { this.cb.onRemove && this.cb.onRemove(a); a.alive = false; a.removed = true; return false; }
        return true;
      });
      this.zombies = this.zombies.filter((z) => this.agents.includes(z));
      const night = 1 - this.daylight();
      const want = Math.round(18 + night * 14);
      if (this.zombies.filter((z) => z.alive).length < want && this.rng() < dt * 0.25) this.spawnZombie(null);
      // eventos de hora em hora
      if (Math.floor(this.t) !== Math.floor(this.lastHour)) this.hourly();
      this.lastHour = this.t;
      this.updateQuests();
    },

    /* ----------------------------------------------------------- zumbis */
    updateZombie(a, dt) {
      const P = this.player;
      a.attackT -= dt; a.repathT -= dt; a.perceiveT -= dt;
      if (!a.active) return;            // distantes ficam parados (custo zero)
      if (a.perceiveT <= 0) {
        a.perceiveT = 0.35;
        // alvos: jogador e NPCs próximos
        let best = null, bd = 1e9;
        const cands = [P].concat(this.frameAgents.filter((o) => o.kind === 'npc' && o.alive));
        for (const t of cands) {
          if (t === P && (P.dead || P.inVehicle)) continue;
          const d = Math.hypot(t.x - a.x, t.z - a.z);
          if (d < bd && (d < 1.8 || this.canSee(a, t, this.visionRange(a, t)))) { best = t; bd = d; }
        }
        if (best) { a.target = best; a.lastSeen = { x: best.x, y: best.y, z: best.z }; if (a.state !== 'chase') { a.state = 'chase'; a.repathT = 0; this.cb.onGroan && this.cb.onGroan(a); } }
        else if (a.state === 'chase') { a.state = 'investigate'; a.target = null; if (a.lastSeen) this.requestPath(a, a.lastSeen.x, a.lastSeen.y, a.lastSeen.z); }
        // audição
        if (a.state !== 'chase') {
          for (const n of this.noises) {
            const d = Math.hypot(n.x - a.x, n.z - a.z);
            if (d < n.r && Math.abs(n.y - a.y) < 8) { a.state = 'investigate'; a.lastSeen = { x: n.x, y: n.y, z: n.z }; this.requestPath(a, n.x, n.y, n.z); break; }
          }
        }
      }
      if (a.state === 'chase' && a.target) {
        const t = a.target;
        if (!t.alive && t !== P) { a.state = 'wander'; a.target = null; return; }
        const d = Math.hypot(t.x - a.x, t.z - a.z);
        if (d < 1.25 && Math.abs(t.y - a.y) < 1.2) {
          a.moving = 0; a.yaw = Math.atan2(t.x - a.x, t.z - a.z);
          if (a.attackT <= 0) {
            a.attackT = 1.3; a.action = 'attack'; a.actionT = 0.5;
            this.damage(t, 9 + this.rng() * 8, a);
          }
          return;
        }
        if (a.repathT <= 0) this.requestPath(a, t.x, t.y, t.z);
        this.moveAgent(a, dt, a.speedRun);
        return;
      }
      if (a.state === 'investigate') {
        if (this.moveAgent(a, dt, a.speedWalk * 1.6)) { a.state = 'wander'; a.stateT = 3; }
        return;
      }
      // vagar
      a.stateT -= dt;
      if (a.stateT <= 0 || !a.path) {
        a.stateT = 6 + this.rng() * 10;
        if (this.rng() < 0.5) { a.path = null; a.moving = 0; return; }
        const r = 8;
        const tx = a.x + (this.rng() - 0.5) * r * 2, tz = a.z + (this.rng() - 0.5) * r * 2;
        const lv = TW.levelAt(a.x, a.y, a.z), n = TW.nodeAt(lv, tx, tz);
        if (n >= 0 && TW.passable(n, false)) { a.path = [{ x: tx, y: a.y, z: tz, direct: true }]; a.pi = 0; }
      }
      if (a.path) this.moveAgent(a, dt, a.speedWalk);
    },

    /* --------------------------------------------------------- sobreviventes */
    updateNpc(n, dt) {
      const P = this.player;
      n.decideT -= dt; n.repathT -= dt; n.attackT -= dt; n.perceiveT -= dt; n.chatT -= dt; n.sayT -= dt;
      if (n.alertT) n.alertT = Math.max(0, n.alertT - dt);
      // necessidades
      const rate = dt / (this.dayLength / 24); // horas
      n.food = Math.max(0, n.food - rate * 2.2); n.water = Math.max(0, n.water - rate * 3);
      const sleeping = n.state === 'sleep';
      n.energy = M.clamp(n.energy + (sleeping ? rate * 14 : -rate * 3.2), 0, 100);
      if (n.food < 30 || n.water < 30) this.consume(n);
      if (n.food <= 0 || n.water <= 0) n.hp -= rate * 4;
      if (n.hurt && n.state !== 'trapped') n.hp = Math.min(n.hp, 40);
      if (n.hp <= 0) { this.kill(n, null); return; }
      n.hp = Math.min(n.maxHp, n.hp + rate * (sleeping ? 6 : 1.5) * (n.hurt ? 0 : 1));

      if (!n.active) { this.abstractNpc(n, dt); return; }

      // percepção de ameaças
      if (n.perceiveT <= 0) {
        n.perceiveT = 0.4;
        n.threat = null;
        let bd = 1e9;
        for (const z of this.frameAgents) {
          if (z.kind !== 'zombie' || !z.alive) continue;
          const d = Math.hypot(z.x - n.x, z.z - n.z);
          if (d < 18 && d < bd && Math.abs(z.y - n.y) < 3 && (d < 4 || this.canSee(n, z, this.visionRange(n, z)))) { bd = d; n.threat = z; }
        }
        if (!n.threat && this.hostileToPlayer(n) && !P.dead && !P.inVehicle) {
          const d = Math.hypot(P.x - n.x, P.z - n.z);
          if (d < 32 && this.canSee(n, P, this.visionRange(n, P))) n.threat = P;
        }
        // NPCs também enfrentam inimigos de outras facções (Corvos atacando)
        if (!n.threat) {
          for (const o of this.frameAgents) {
            if (o.kind !== 'npc' || !o.alive || o === n) continue;
            if (this.isEnemy(n, o) && Math.hypot(o.x - n.x, o.z - n.z) < 25 && this.canSee(n, o, 30)) { n.threat = o; break; }
          }
        }
        // ouvir tiros: patrulhas investigam
        if (!n.threat && (n.role === 'guarda' || n.role === 'lider') && n.state !== 'investigate') {
          for (const no of this.noises) if (no.source === 'gun' && Math.hypot(no.x - n.x, no.z - n.z) < no.r && Math.hypot(no.x - n.x, no.z - n.z) > 12) { n.state = 'investigate'; n.stateT = 25; this.requestPath(n, no.x, no.y, no.z); this.say(n, 'Tiros! Vou verificar.'); break; }
        }
      }
      if (n.state === 'trapped') {
        // preso esperando resgate
        n.moving = 0;
        if (n.distP < 4 && n.sayT <= 0) { n.sayT = 8; this.say(n, 'Graças a Deus! Estou presa aqui há dias. Me tire daqui!'); }
        return;
      }
      if (n.threat) { this.fightOrFlee(n, dt); return; }
      if (n.action && (n.actionT -= dt) <= 0) n.action = null;

      // decisões
      if (n.decideT <= 0) { n.decideT = 2 + this.rng() * 2; this.decide(n); }
      this.execute(n, dt);
    },

    isEnemy(a, b) {
      if (a.companion && b.faction && this.factions[b.faction].hostile && this.hostileToPlayer(b)) return true;
      if (b.companion && a.faction && this.factions[a.faction].hostile && this.hostileToPlayer(a)) return true;
      if (!a.faction || !b.faction || a.faction === b.faction) return false;
      const fa = this.factions[a.faction];
      return (fa.relations[b.faction] || 0) < -50 && (a.raiding || b.raiding);
    },

    consume(n) {
      for (const it of n.inv.items) {
        const d = IT.ITEMS[it.id];
        if ((n.food < 30 && d.food) || (n.water < 30 && d.water)) {
          n.food = Math.min(100, n.food + (d.food || 0)); n.water = Math.min(100, n.water + (d.water || 0));
          n.inv.remove(it.id, 1); n.action = 'eat'; n.actionT = 1.5;
          return;
        }
      }
      // estoque da facção ou da base
      const f = n.faction && this.factions[n.faction];
      if (f && f.res.food > 0 && n.food < 30) { f.res.food -= 1; n.food += 40; }
      if (f && f.res.water > 0 && n.water < 30) { f.res.water -= 1; n.water += 40; }
      if (n.companion || this.base.residents.includes(n.id)) {
        const st = this.base.storage;
        if (n.food < 30) { const it = st.items.find((e) => IT.ITEMS[e.id].food); if (it) { n.food += IT.ITEMS[it.id].food; st.remove(it.id, 1); } }
        if (n.water < 30) { const it = st.items.find((e) => IT.ITEMS[e.id].water); if (it) { n.water += IT.ITEMS[it.id].water; st.remove(it.id, 1); } }
        if ((n.food < 15 || n.water < 15) && n.sayT <= 0) { n.sayT = 40; this.say(n, n.food < 15 ? 'Estou com muita fome... tem comida?' : 'Preciso de água.'); if (n.companion) this.adjustTrust(n, -2); }
      }
    },

    fightOrFlee(n, dt) {
      const t = n.threat;
      if (!t.alive && t !== this.player) { n.threat = null; return; }
      const d = Math.hypot(t.x - n.x, t.z - n.z);
      const w = n.weapon && IT.ITEMS[n.weapon].weapon;
      const hasGun = w && w.type === 'gun' && (n.mag > 0 || n.inv.count(w.ammo) > 0);
      const brave = n.traits.brave + (n.companion ? 0.25 : 0) + (n.role === 'guarda' ? 0.2 : 0);
      const flee = n.hp < 30 || (!w && brave < 0.7) || (w && w.type === 'melee' && brave < 0.45 && d > 3) || (n.hurt);
      n.yaw = Math.atan2(t.x - n.x, t.z - n.z);
      if (flee) {
        if (n.state !== 'flee') { n.state = 'flee'; this.say(n, n.mag === 0 && w && w.type === 'gun' ? 'Estou sem munição!' : 'Corram!'); }
        if (n.repathT <= 0) {
          const ax = n.x - t.x, az = n.z - t.z, l = Math.hypot(ax, az) || 1;
          const home = n.home;
          const tx = Math.hypot(home.x - t.x, home.z - t.z) > d + 5 ? home.x : n.x + (ax / l) * 15, tz = Math.hypot(home.x - t.x, home.z - t.z) > d + 5 ? home.z : n.z + (az / l) * 15;
          this.requestPath(n, tx, home.y, tz);
        }
        this.moveAgent(n, dt, n.speedRun);
        if (d > 25) n.threat = null;
        return;
      }
      n.state = 'fight';
      if (hasGun && d < w.range) {
        n.moving = 0;
        if (n.mag <= 0) { // recarregar
          if (n.attackT <= 0) { const got = n.inv.remove(w.ammo, w.mag); n.mag = got; n.attackT = 2; n.action = 'reload'; n.actionT = 1.6; }
          return;
        }
        if (n.attackT <= 0 && TW.losClear(n.x, n.y + 1.5, n.z, t.x, t.y + 1.3, t.z)) {
          n.attackT = w.rate * (1.6 - n.skills.shoot) + 0.25;
          n.mag--;
          n.action = 'shoot'; n.actionT = 0.2;
          this.noise(n.x, n.y, n.z, w.noise, 'gun');
          const hitP = M.clamp(0.3 + n.skills.shoot * 0.55 - d / (w.range * 1.6), 0.08, 0.92);
          const hit = this.rng() < hitP;
          if (hit) this.damage(t, w.dmg * (w.pellets ? Math.min(w.pellets, 4) * 0.8 : 1) * (t === this.player ? 0.55 : 1), n);
          this.cb.onShot && this.cb.onShot(n, t, hit);
        }
        return;
      }
      // corpo a corpo
      if (d > 1.4) {
        if (n.repathT <= 0) this.requestPath(n, t.x, t.y, t.z);
        this.moveAgent(n, dt, n.speedRun * 0.9);
      } else {
        n.moving = 0;
        if (n.attackT <= 0) {
          const mw = w && w.type === 'melee' ? w : { dmg: 12, rate: 1 };
          n.attackT = mw.rate + 0.3; n.action = 'melee'; n.actionT = 0.4;
          this.damage(t, mw.dmg * (t === this.player ? 0.5 : 1), n);
        }
      }
    },

    decide(n) {
      const P = this.player;
      const h = this.hour(), day = this.daylight();
      // companheiros seguem ordens
      if (n.companion) {
        const ord = n.order || 'follow';
        if (ord === 'follow') { n.task = 'follow'; }
        else if (ord === 'wait') n.task = 'wait';
        else if (ord === 'defend') n.task = 'defend';
        else if (ord === 'base') n.task = this.base.claimed ? 'base' : 'follow';
        // médico trata feridos
        if (n.skills.med > 0.5) this.medicCheck(n);
        return;
      }
      if (n.hurt) { n.task = 'rest'; return; }
      // médicos: tratar feridos próximos
      if (n.skills.med > 0.5 && this.medicCheck(n)) return;
      // noite: abrigo e sono (guardas fazem vigília)
      if ((h >= 21 || h < 6) && n.role !== 'guarda') { n.task = n.energy < 85 ? 'sleep' : 'home'; return; }
      // sociabilidade
      if (n.traits.social > 0.55 && n.chatT <= 0 && this.rng() < 0.25) {
        const friend = this.frameAgents.find((o) => o.kind === 'npc' && o !== n && o.alive && !o.companion && o.faction === n.faction && Math.hypot(o.x - n.x, o.z - n.z) < 15 && (o.task !== 'chat'));
        if (friend) { n.task = 'chat'; n.chatWith = friend; n.chatT = 40; friend.task = 'chat'; friend.chatWith = n; friend.chatT = 40; friend.decideT = 8; n.decideT = 8; return; }
      }
      const role = n.role;
      if (role === 'agricultor' && day > 0.5) { n.task = 'farm'; return; }
      if (role === 'comerciante') { n.task = 'shop'; return; }
      if (role === 'guarda' || role === 'lider') { n.task = this.rng() < 0.6 ? 'patrol' : 'home'; return; }
      if ((role === 'explorador' || role === 'solitario' && n.traits.brave > 0.6) && day > 0.6 && n.energy > 40) { n.task = this.rng() < 0.5 ? 'scavenge' : 'home'; return; }
      n.task = this.rng() < 0.7 ? 'home' : 'wander';
    },

    medicCheck(n) {
      const wounded = this.frameAgents.find((o) => o.kind === 'npc' && o.alive && o !== n && o.hp < 60 && !o.hurt && Math.hypot(o.x - n.x, o.z - n.z) < 25 && (o.faction === n.faction || o.companion && n.companion));
      if (wounded && (n.inv.has('bandagem') || n.inv.has('kit_medico'))) { n.task = 'heal'; n.healTarget = wounded; return true; }
      return false;
    },

    execute(n, dt) {
      const P = this.player;
      const goTo = (x, y, z, speed, near) => {
        const d = Math.hypot(x - n.x, z - n.z);
        if (d < (near || 1.2) && Math.abs(y - n.y) < 1.5) { n.moving = 0; n.path = null; return true; }
        if (!n.path || n.repathT <= 0 || !n.goal || Math.hypot(n.goal.x - x, n.goal.z - z) > 3) this.requestPath(n, x, y, z);
        this.moveAgent(n, dt, speed);
        return false;
      };
      n.state = n.task;
      switch (n.task) {
        case 'follow': {
          const d = Math.hypot(P.x - n.x, P.z - n.z);
          if (P.inVehicle) { n.moving = 0; break; }
          if (d > 3.5 || Math.abs(P.y - n.y) > 1.5) goTo(P.x, P.y, P.z, d > 9 ? n.speedRun : n.speedWalk * 1.4, 2.8);
          else { n.moving = 0; n.path = null; n.yaw = Math.atan2(P.x - n.x, P.z - n.z); }
          break;
        }
        case 'wait': n.moving = 0; break;
        case 'defend': {
          const o = n.orderPos || n;
          if (Math.hypot(o.x - n.x, o.z - n.z) > 6) goTo(o.x, o.y, o.z, n.speedWalk, 2); else n.moving = 0;
          break;
        }
        case 'base': {
          const job = this.base.jobs[n.id] || 'descanso';
          const spot = this.jobSpot(job, n);
          goTo(spot.x, spot.y, spot.z, n.speedWalk, 2);
          break;
        }
        case 'rest': case 'sleep': case 'home': {
          if (goTo(n.home.x, n.home.y, n.home.z, n.speedWalk, 1.5) && n.task === 'sleep') n.state = 'sleep';
          break;
        }
        case 'farm': {
          const f = this.factions.colina;
          if (!n.workPos) n.workPos = { x: TW.camp.x0 + 30 + this.rng() * 26, y: TW.ELEV, z: TW.camp.z0 + 52 + this.rng() * 18 };
          if (goTo(n.workPos.x, n.workPos.y, n.workPos.z, n.speedWalk, 1)) { n.action = 'work'; if (this.rng() < dt * 0.02) f.res.food += 1; if (this.rng() < dt * 0.05) n.workPos = null; }
          break;
        }
        case 'shop': {
          const b = B.posto;
          const spot = { x: b.x0 + 6, y: b.floorY(0), z: b.z0 + 4 };
          goTo(spot.x, spot.y, spot.z, n.speedWalk, 1.5);
          if (n.moving < 0.1) n.yaw = Math.atan2(P.x - n.x, P.z - n.z);
          break;
        }
        case 'patrol': {
          const f = this.factions[n.faction];
          if (!n.workPos || n.patrolDone) { const a = this.rng() * 6.28; n.workPos = this.freePointNear(f.base.x + Math.cos(a) * f.base.r * 0.6, f.base.z + Math.sin(a) * f.base.r * 0.6, 4); n.patrolDone = false; }
          if (goTo(n.workPos.x, n.workPos.y, n.workPos.z, n.speedWalk, 1.5)) n.patrolDone = this.rng() < dt * 0.3;
          break;
        }
        case 'scavenge': {
          if (!n.lootTarget || n.lootTarget.opened) {
            const opts = TW.containers.filter((c) => !c.opened && !c.room.locked && !(B[c.bid].faction && B[c.bid].faction !== n.faction));
            n.lootTarget = opts[Math.floor(this.rng() * opts.length)];
            if (!n.lootTarget) { n.task = 'home'; break; }
          }
          const c = n.lootTarget;
          if (goTo(c.x, c.y0, c.z, n.speedWalk * 1.2, 1.6)) {
            this.openContainer(c, n);
            if (c.items && c.items.length) { const take = c.items.shift(); n.inv.add(take.id, take.qty, take.text ? { text: take.text } : undefined); }
            n.action = 'loot'; n.actionT = 1.5;
            n.lootTarget = null;
            if (n.inv.weight() > 12) n.task = 'deposit';
          }
          break;
        }
        case 'deposit': {
          if (goTo(n.home.x, n.home.y, n.home.z, n.speedWalk, 1.5)) {
            const f = n.faction && this.factions[n.faction];
            for (const it of n.inv.items.slice()) {
              const d = IT.ITEMS[it.id];
              if (d.cat === 'arma' || d.cat === 'municao') continue;
              if (f) { if (d.food) f.res.food += it.qty; else if (d.water) f.res.water += it.qty; else if (d.cat === 'remedio') f.res.meds += it.qty; else if (d.fuel) f.res.fuel += it.qty; n.inv.remove(it.id, it.qty); }
            }
            n.task = 'home';
          }
          break;
        }
        case 'heal': {
          const w = n.healTarget;
          if (!w || !w.alive || w.hp >= 60) { n.task = 'home'; break; }
          if (goTo(w.x, w.y, w.z, n.speedWalk * 1.3, 1.3)) {
            const item = n.inv.has('kit_medico') ? 'kit_medico' : 'bandagem';
            n.inv.remove(item, 1); w.hp = Math.min(w.maxHp, w.hp + IT.ITEMS[item].heal * 1.4);
            n.action = 'heal'; n.actionT = 2;
            this.say(n, 'Fique parado, vou cuidar desse ferimento.');
            this.adjustRel(w, n.id, 8);
            n.task = 'home';
          }
          break;
        }
        case 'chat': {
          const o = n.chatWith;
          if (!o || !o.alive || o.task !== 'chat') { n.task = 'home'; break; }
          if (goTo(o.x, o.y, o.z, n.speedWalk, 1.8)) {
            n.yaw = Math.atan2(o.x - n.x, o.z - n.z); n.action = 'talk';
            if (n.sayT <= 0 && n.distP < 25) { n.sayT = 6 + this.rng() * 4; this.say(n, this.chatLine(n, o)); }
            this.adjustRel(n, o.id, dt * 0.4);
            this.socialCheck(n, o);
          }
          break;
        }
        case 'investigate': {
          if (this.moveAgent(n, dt, n.speedWalk * 1.4) || (n.stateT -= dt) < 0) n.task = 'patrol';
          break;
        }
        default: { // vagar
          if (!n.path || n.pi >= n.path.length) { const p = this.freePointNear(n.home.x, n.home.z, 10); if (Math.abs(n.home.y - TW.ELEV) < 1) this.requestPath(n, p.x, p.y, p.z); else n.task = 'home'; }
          this.moveAgent(n, dt, n.speedWalk);
        }
      }
    },

    jobSpot(job, n) {
      const b = this.base;
      const st = (type) => b.structures.find((s) => s.type === type);
      const s = (job === 'agricultor' && st('horta')) || (job === 'medico' && st('enfermaria')) || (job === 'mecanico' && st('oficina')) || (job === 'guarda' && (st('torre') || st('barricada'))) || null;
      if (s) return { x: s.x + 1.5, y: s.y || TW.ELEV, z: s.z + 1.5 };
      if (!n.baseSpot) { const bb = b.bid && B[b.bid]; n.baseSpot = bb ? (TW.randomRoomPoint(bb, this.rng, 0) || { x: b.x, y: TW.ELEV, z: b.z }) : this.freePointNear(b.x, b.z, 6); }
      return n.baseSpot;
    },

    chatLine(n, o) {
      const lines = [
        'Você viu o céu hoje? Parece que vai chover.', 'Precisamos de mais água filtrada.', 'Ouvi zumbis perto da avenida ontem à noite.',
        'Lembra de como era a feira de domingo?', 'Os Corvos passaram pela estrada de novo.', 'Estou cansado, mas a gente segue.',
        'Achei que ia morrer naquele hospital.', 'Quando isso acabar, quero ver o mar.', 'Você confia nesse forasteiro?',
      ];
      if (n.partner === o.id) return ['Fica perto de mim hoje, tá?', 'Guardei uma fruta pra você.', 'A gente vai sair dessa juntos.'][Math.floor(this.rng() * 3)];
      if ((n.rel[o.id] || 0) < -30) return ['Não me dá ordens.', 'Você pegou minha parte da comida!', 'Me deixa em paz.'][Math.floor(this.rng() * 3)];
      return lines[Math.floor(this.rng() * lines.length)];
    },

    // relações entre NPCs evoluem pela convivência
    socialCheck(n, o) {
      const a = n.rel[o.id] || 0, b = o.rel[n.id] || 0;
      if (!n.partner && !o.partner && a > 85 && b > 85 && n.age >= 18 && o.age >= 18 && this.rng() < 0.002) {
        n.partner = o.id; o.partner = n.id;
        this.addLog(n.name.split(' ')[0] + ' e ' + o.name.split(' ')[0] + ' agora estão juntos.', 'social');
      }
      // disputa por recursos quando a comida está curta
      const f = n.faction && this.factions[n.faction];
      if (f && f.res.food < 5 && this.rng() < 0.003) {
        this.adjustRel(n, o.id, -15); this.adjustRel(o, n.id, -15);
        this.say(n, 'Isso não é justo, você comeu mais que todo mundo!', 4);
        this.addLog(n.name.split(' ')[0] + ' e ' + o.name.split(' ')[0] + ' discutiram por causa da comida.', 'social');
      }
    },

    // simulação simplificada para quem está longe
    abstractNpc(n, dt) {
      n.moving = 0;
      if (n.state === 'trapped' || n.companion && n.order === 'follow') {
        if (n.companion && n.order === 'follow' && n.distP > DETAIL_R) { const p = this.freePointNear(this.player.x, this.player.z, 3); n.x = p.x; n.z = p.z; n.y = this.player.y; }
        return;
      }
      n.decideT -= dt;
      if (n.decideT > 0) return;
      n.decideT = 3;
      const h = this.hour();
      if ((h >= 21 || h < 6) && Math.hypot(n.x - n.home.x, n.z - n.home.z) > 2) { n.x = n.home.x; n.y = n.home.y; n.z = n.home.z; }
    },

    openContainer(c, by) {
      if (!c.items) {
        const rng = M.mulberry32(c.id.length * 1000 + parseInt(c.id.slice(1), 10) * 7919);
        const n = c.room.locked ? 4 : 1 + Math.floor(rng() * 3);
        c.items = IT.rollLoot(c.loot, rng, n);
        if (rng() < 0.18 && !c.room.locked) c.items = [];
      }
      c.opened = true;
      return c.items;
    },

    /* ----------------------------------------------------------- companheiros */
    recruit(n) {
      n.companion = true; n.order = 'follow';
      if (n.faction) {
        const f = this.factions[n.faction];
        f.members = f.members.filter((m) => m !== n.id);
        if (f.hostile) n.leftFaction = true;
        n.formerFaction = n.faction; n.faction = null;
        if (f.hostile) { this.addLog(n.name + ' abandonou ' + f.name + ' para seguir você.', 'faction'); this.changeRep(f.id, -20); }
        else this.changeRep(f.id, -5);
      }
      n.hostile = false; n.hurt = false; n.missing = false;
      this.addLog(n.name + ' agora viaja com você.', 'social');
    },
    leaveCompanion(n, text) {
      n.companion = false; n.order = null;
      if (text) this.say(n, text, 5);
      this.base.residents = this.base.residents.filter((r) => r !== n.id);
      this.addLog(n.name + ' deixou o seu grupo.', 'social');
    },
    companions() { return Object.values(this.npcs).filter((n) => n.alive && n.companion); },

    /* --------------------------------------------------------------- missões */
    offerQuest(n) {
      const q = n.questDef;
      if (!q) return null;
      let quest = this.quests.find((x) => x.giver === n.id);
      if (quest) return quest;
      quest = Object.assign({ id: 'q_' + n.id, giver: n.id, status: 'offered', progress: 0 }, q);
      if (q.faction) quest.factionId = n.faction;
      if (q.type === 'clear') quest.baseKills = this.killsByBuilding[q.bid] || 0;
      this.quests.push(quest);
      return quest;
    },
    acceptQuest(q) { q.status = 'active'; this.addLog('Missão aceita: ' + q.title, 'quest'); },
    questReady(q, inv) {
      if (q.status !== 'active') return false;
      if (q.type === 'fetch') return inv.count(q.item) >= q.qty;
      if (q.type === 'clear') return (this.killsByBuilding[q.bid] || 0) - q.baseKills >= q.kills;
      if (q.type === 'rescue') { const t = this.npcs[q.target]; return t && t.alive && t.rescued && Math.hypot(t.x - this.npcs[q.giver].x, t.z - this.npcs[q.giver].z) < 15; }
      return false;
    },
    completeQuest(q, inv) {
      const n = this.npcs[q.giver];
      if (q.type === 'fetch') inv.remove(q.item, q.qty);
      if (q.type === 'rescue') { const t = this.npcs[q.target]; if (t) { t.companion = false; t.order = null; t.faction = 'mercadores'; if (!this.factions.mercadores.members.includes(t.id)) this.factions.mercadores.members.push(t.id); t.state = 'idle'; t.task = 'home'; t.home = { x: n.x, y: n.y, z: n.z }; } }
      for (const id in (q.reward || {})) inv.add(id, q.reward[id]);
      q.status = 'done';
      if (n) {
        this.adjustTrust(n, q.trust || 10, 'Você cumpriu o que prometeu: ' + q.title + '.');
        n.affinity = Math.min(100, n.affinity + 10);
        if (q.item === 'antibiotico' && n.hurt) { n.hurt = false; n.hp = 80; }
        if (q.defect) n.wantsToDefect = true;
      }
      if (q.factionId) {
        this.changeRep(q.factionId, q.rep || 10);
        const f = this.factions[q.factionId];
        if (q.item === 'galao') f.res.fuel += q.qty * 5;
        if (q.item === 'kit_medico') f.res.meds += q.qty * 3;
        f.morale = Math.min(100, f.morale + 10);
      }
      this.addLog('Missão concluída: ' + q.title, 'quest');
    },
    updateQuests() {
      for (const q of this.quests) {
        if (q.status !== 'active') continue;
        const g = this.npcs[q.giver];
        if (!g || !g.alive) { q.status = 'failed'; this.addLog('Missão falhou: ' + q.title + ' (' + (g ? g.name : '') + ' morreu).', 'quest'); continue; }
        if (q.type === 'rescue') { const t = this.npcs[q.target]; if (t && !t.alive) { q.status = 'failed'; this.addLog('Missão falhou: ' + q.title, 'quest'); } }
      }
    },

    /* --------------------------------------------------------- hora em hora */
    hourly() {
      const h = Math.floor(this.hour());
      // consumo e produção das facções
      for (const id in this.factions) {
        const f = this.factions[id];
        if (!f.alive) continue;
        const n = f.members.length;
        f.res.food = Math.max(0, f.res.food - n * 0.12); f.res.water = Math.max(0, f.res.water - n * 0.15);
        if (id === 'colina') { f.res.food += 0.35; f.res.water += 0.3; f.res.fuel = Math.max(0, f.res.fuel - 0.05); }
        if (id === 'clinica') f.res.water += 0.2;
        const short = f.res.food < 3 || f.res.water < 3;
        f.morale = M.clamp(f.morale + (short ? -4 : 1), 0, 100);
        if (f.morale < 20 && n > 1 && this.rng() < 0.1) {
          const lid = f.members.find((m) => this.npcs[m].role !== 'lider');
          const leaver = this.npcs[lid];
          if (leaver) { f.members = f.members.filter((m) => m !== lid); leaver.faction = null; leaver.role = 'solitario'; leaver.hostile = false; leaver.leftFaction = true; this.addLog(leaver.name + ' abandonou ' + f.name + ' por falta de recursos.', 'faction'); }
        }
      }
      if (this.factions.colina.res.fuel <= 0 && !this.flags.colinaFuel) { this.flags.colinaFuel = true; this.addLog('Rádio da Colina Verde: "O gerador parou. Precisamos de combustível!"', 'event'); }
      // base do jogador
      this.baseHourly();
      // eventos dinâmicos
      if (h >= 7 && h <= 22 && this.rng() < 0.22) this.randomEvent();
      if (this.rng() < 0.06) this.raidEvent();
    },

    baseHourly() {
      const b = this.base;
      if (!b.claimed) return;
      const st = b.storage;
      const res = b.residents.map((id) => this.npcs[id]).filter((n) => n && n.alive);
      const has = (t) => b.structures.some((s) => s.type === t);
      // produção por função
      for (const n of res) {
        const job = b.jobs[n.id] || 'descanso';
        if (job === 'agricultor' && has('horta') && this.rng() < 0.5 + n.skills.farm * 0.4) st.add('fruta', 1);
        if (job === 'explorador' && this.rng() < 0.3 + n.skills.scav * 0.3) {
          const loot = IT.rollLoot(['casa_geral', 'casa_cozinha', 'mercado_comida', 'oficina_pecas'][Math.floor(this.rng() * 4)], this.rng, 1);
          loot.forEach((it) => st.add(it.id, it.qty, it.text ? { text: it.text } : undefined));
          if (this.rng() < 0.05) { n.hp -= 30; this.addLog(n.name + ' voltou ferido de uma expedição.', 'base'); }
        }
        if (job === 'medico') res.forEach((o) => { o.hp = Math.min(o.maxHp, o.hp + (has('enfermaria') ? 15 : 6)); });
        if (job === 'mecanico') b.structures.forEach((s) => { s.hp = Math.min(100, (s.hp || 100) + 10); });
      }
      if (has('tanque') && this.rng() < 0.6) st.add('agua', 1);
      if (has('horta') && !res.some((n) => b.jobs[n.id] === 'agricultor') && this.rng() < 0.15) st.add('fruta', 1);
      b.power = has('gerador') && st.has('galao') && this.hour() > 18 ? true : b.power;
      if (b.power && this.rng() < 0.08) st.remove('galao', 1);
      // escassez afeta o moral
      const food = st.items.filter((e) => IT.ITEMS[e.id].food).reduce((s, e) => s + e.qty, 0);
      const water = st.items.filter((e) => IT.ITEMS[e.id].water).reduce((s, e) => s + e.qty, 0);
      const short = res.length > 0 && (food < res.length || water < res.length);
      b.morale = M.clamp(b.morale + (short ? -5 : 2), 0, 100);
      if (short && this.rng() < 0.3) this.addLog('Base: os moradores reclamam da falta de ' + (food < res.length ? 'comida' : 'água') + '.', 'base');
      if (b.morale < 20 && res.length && this.rng() < 0.15) {
        const n = res[Math.floor(this.rng() * res.length)];
        this.leaveCompanion(n, 'Aqui não tem como viver. Estou indo embora.');
        n.home = this.freePointNear(TW.center.x, TW.center.z, 60);
      }
      b.defense = b.structures.reduce((s, x) => s + (x.type === 'muro' ? 3 : x.type === 'barricada' ? 2 : x.type === 'torre' ? 4 : x.type === 'armadilha' ? 1 : 0), 0) + res.filter((n) => b.jobs[n.id] === 'guarda').length * 4;
    },

    randomEvent() {
      const r = this.rng();
      const P = this.player;
      if (r < 0.25) {
        // horda atacando um local
        const targets = Object.values(this.factions).filter((f) => f.alive).map((f) => ({ name: f.name, x: f.base.x, z: f.base.z, f }));
        if (this.base.claimed) targets.push({ name: 'sua base', x: this.base.x, z: this.base.z, base: true });
        const t = targets[Math.floor(this.rng() * targets.length)];
        this.addLog('Rádio: "Socorro! Uma horda está chegando em ' + t.name + '!"', 'event');
        const count = 6 + Math.floor(this.rng() * 6);
        for (let i = 0; i < count; i++) {
          const a = this.rng() * 6.28;
          const p = this.freePointNear(t.x + Math.cos(a) * 45, t.z + Math.sin(a) * 45, 6);
          const z = this.spawnZombie(p, { force: true });
          if (z) { z.horde = true; z.state = 'investigate'; z.lastSeen = { x: t.x, y: TW.ELEV, z: t.z }; z.path = [{ x: t.x + (this.rng() - 0.5) * 8, y: TW.ELEV, z: t.z + (this.rng() - 0.5) * 8, direct: true }]; z.pi = 0; }
        }
        // longe do jogador: resolução simplificada
        if (Math.hypot(t.x - P.x, t.z - P.z) > DETAIL_R + 40) {
          if (t.f) { const loss = this.rng() < 0.25; t.f.res.food = Math.max(0, t.f.res.food - 5); if (loss && t.f.members.length > 1) { const id = t.f.members[t.f.members.length - 1]; const v = this.npcs[id]; if (v && v.role !== 'lider') this.kill(v, { kind: 'zombie' }); } }
          if (t.base) { const dmg = Math.max(0, 8 - this.base.defense); this.base.structures.forEach((s) => { s.hp = (s.hp || 100) - dmg * 3; }); if (dmg > 0) this.addLog('A horda danificou as defesas da sua base.', 'base'); else this.addLog('As defesas da sua base contiveram a horda.', 'base'); }
        }
      } else if (r < 0.4) {
        // caixa de suprimentos
        const p = TW.randomStreetPoint(this.rng);
        const c = { id: 'crate' + Math.floor(this.rng() * 1e6), name: 'Caixa de suprimentos', kind: 'container', loot: 'caixa_suprimentos', x: p.x, z: p.z, x0: p.x - 0.6, x1: p.x + 0.6, z0: p.z - 0.6, z1: p.z + 0.6, y0: TW.ELEV, y1: TW.ELEV + 1, opened: false, items: null, room: { locked: false }, color: [0.3, 0.45, 0.3], crate: true, bid: null };
        this.crates.push(c);
        this.addLog('Sinal de rádio: suprimentos foram deixados na rua (marcado no mapa).', 'event');
        this.cb.onCrate && this.cb.onCrate(c);
      } else if (r < 0.55) {
        // sobrevivente desaparece
        const cands = Object.values(this.npcs).filter((n) => n.alive && n.faction && !n.companion && n.role !== 'lider' && !n.missing && n.distP > 60);
        const n = cands[Math.floor(this.rng() * cands.length)];
        if (n) {
          const b = TW.buildings.filter((x) => !x.faction)[Math.floor(this.rng() * 6)];
          const p = b && TW.randomRoomPoint(b, this.rng);
          if (p) {
            n.x = p.x; n.y = p.y; n.z = p.z; n.state = 'trapped'; n.missing = true;
            const f = this.factions[n.faction];
            const leader = f.members.map((id) => this.npcs[id]).find((m) => m.role === 'lider' && m.alive) || f.members.map((id) => this.npcs[id]).find((m) => m.alive && m !== n);
            if (leader && !this.quests.some((q) => q.target === n.id && q.status !== 'done')) {
              const q = { id: 'q_res_' + n.id + Math.floor(this.t), giver: leader.id, type: 'rescue', target: n.id, title: 'Resgate: ' + n.name, desc: n.name + ' não voltou de uma expedição ao ' + b.name + '. Encontre e traga de volta.', rep: 20, trust: 20, reward: { kit_medico: 1 }, factionId: f.id, status: 'offered', progress: 0, extra: true };
              this.quests.push(q);
              leader.extraQuest = q;
            }
            this.addLog(f.name + ': "' + n.name + ' desapareceu perto do ' + b.name + '."', 'event');
          }
        }
      } else if (r < 0.7) {
        // comerciante itinerante chega
        if (!this.npcs.caravana) {
          const r2 = { id: 'caravana', name: 'Otávio da Caravana', g: 'm', age: 50, spec: 'comerciante', faction: null, role: 'comerciante', traits: { brave: 0.5, gen: 0.4, loyal: 0.4, social: 0.9 }, look: { skin: 0.5, hair: 0x6a6a6a, hairLen: 0, top: 0x8a5a2a, bottom: 0x4a3a2a, build: 1.05 }, bio: 'Viaja de cidade em cidade trocando mercadorias.', weapon: 'espingarda', ammo: 10, trader: true };
          const n = this.spawnNpc(r2);
          const p = this.freePointNear(TW.camp.gate.x, TW.camp.gate.z - 8, 4);
          n.x = p.x; n.z = p.z; n.y = p.y; n.home = p; n.trust = 10; n.leaveAt = this.t + 18;
          n.inv.add('antibiotico', 3); n.inv.add('kit_medico', 2); n.inv.add('mun_12', 20); n.inv.add('sementes', 3); n.inv.add('mun_556', 30);
          this.addLog('Um comerciante itinerante chegou à entrada da Colina Verde. Fica até amanhã.', 'event');
        }
      } else if (r < 0.8) {
        this.addLog('Você ouve o ronco de um avião ao longe, ao norte.', 'event');
        this.cb.onFlyover && this.cb.onFlyover();
      } else if (r < 0.9) {
        const f = this.factions.mercadores;
        if (f.alive) { f.res.fuel += 3; this.addLog('Os Mercadores do Posto encontraram um caminhão-tanque abandonado na estrada.', 'event'); }
      } else {
        // sobreviventes encontram abrigo abandonado
        const f = this.factions.colina;
        if (f.alive) { f.res.food += 6; f.morale += 5; this.addLog('A Colina Verde encontrou uma despensa intacta numa fazenda próxima.', 'event'); }
      }
      // comerciante itinerante vai embora
      const car = this.npcs.caravana;
      if (car && car.alive && car.leaveAt && this.t > car.leaveAt && car.distP > 40) { car.alive = false; car.removed = true; delete this.npcs.caravana; this.agents = this.agents.filter((a) => a !== car); this.cb.onRemove && this.cb.onRemove(car); this.addLog('O comerciante itinerante seguiu viagem.', 'event'); }
    },

    raidEvent() {
      const cor = this.factions.corvos;
      if (!cor.alive || cor.members.length < 2) return;
      const targets = ['colina', 'mercadores', 'clinica'].map((id) => this.factions[id]).filter((f) => f.alive);
      if (this.base.claimed && this.factions.corvos.rep < 0) targets.push({ id: 'base', name: 'sua base', base: { x: this.base.x, z: this.base.z }, isBase: true });
      const t = targets[Math.floor(this.rng() * targets.length)];
      if (!t) return;
      const P = this.player;
      const near = Math.hypot(t.base.x - P.x, t.base.z - P.z) < DETAIL_R + 30;
      this.addLog('Os Corvos estão atacando ' + t.name + '!', 'faction');
      if (near) {
        // ataque real: membros armados vão até o alvo
        cor.members.map((id) => this.npcs[id]).filter((n) => n && n.alive && n.role !== 'lider').slice(0, 2).forEach((n) => {
          n.raiding = true; n.task = 'patrol'; n.workPos = this.freePointNear(t.base.x, t.base.z, 6); n.decideT = 60;
        });
        if (t.isBase) this.factions.corvos.rep = Math.min(this.factions.corvos.rep, -10);
      } else if (t.isBase) {
        const st = this.base.storage;
        if (this.base.defense < 8) { const taken = st.items.slice(0, 3); taken.forEach((e) => st.remove(e.id, Math.ceil(e.qty / 2))); this.addLog('Os Corvos saquearam parte do seu depósito.', 'base'); }
        else this.addLog('As defesas da sua base repeliram os Corvos.', 'base');
      } else {
        const strength = cor.members.length * 2 + cor.res.ammo / 40;
        const def = t.members.length * 1.5 + t.res.ammo / 40;
        if (strength > def) { const loot = Math.min(10, t.res.food); t.res.food -= loot; cor.res.food += loot; t.morale -= 10; this.addLog('Os Corvos saquearam ' + t.name + '.', 'faction'); }
        else { cor.morale -= 10; this.addLog(t.name + ' repeliu o ataque dos Corvos.', 'faction'); }
        t.relations.corvos = Math.max(-100, (t.relations.corvos || 0) - 10);
      }
    },

    /* ----------------------------------------------------------------- base */
    claimBase(b) {
      const base = this.base;
      base.claimed = true; base.bid = b.id; base.x = (b.x0 + b.x1) / 2; base.z = (b.z0 + b.z1) / 2; base.name = b.name;
      this.addLog('Você transformou ' + b.name + ' na sua base.', 'base');
    },

    /* ---------------------------------------------------------- salvamento */
    serialize() {
      const npcs = {};
      for (const id in this.npcs) {
        const n = this.npcs[id];
        npcs[id] = { x: n.x, y: n.y, z: n.z, hp: n.hp, alive: n.alive, trust: n.trust, affinity: n.affinity, met: n.met, memory: n.memory, rel: n.rel, partner: n.partner,
          companion: n.companion, order: n.order, orderPos: n.orderPos, home: n.home, faction: n.faction, role: n.role, inv: n.inv.serialize(), weapon: n.weapon, mag: n.mag,
          food: n.food, water: n.water, energy: n.energy, missing: n.missing, hurt: n.hurt, state: n.state === 'trapped' ? 'trapped' : 'idle', rescued: n.rescued, leftFaction: n.leftFaction, angryAtPlayer: n.angryAtPlayer, wantsToDefect: n.wantsToDefect, formerFaction: n.formerFaction, skills: n.skills };
      }
      const fac = {};
      for (const id in this.factions) { const f = this.factions[id]; fac[id] = { rep: f.rep, res: f.res, morale: f.morale, members: f.members, relations: f.relations, alive: f.alive }; }
      return {
        t: this.t, npcs, factions: fac, log: this.log.slice(0, 40), quests: this.quests, killsByBuilding: this.killsByBuilding, flags: this.flags,
        base: { claimed: this.base.claimed, bid: this.base.bid, x: this.base.x, z: this.base.z, name: this.base.name, structures: this.base.structures, storage: this.base.storage.serialize(), residents: this.base.residents, jobs: this.base.jobs, morale: this.base.morale },
        containers: TW.containers.filter((c) => c.opened).map((c) => ({ id: c.id, items: c.items })),
        doors: TW.doors.map((d) => ({ id: d.id, open: d.open, locked: d.locked, broken: d.broken })),
        crates: this.crates.map((c) => ({ id: c.id, x: c.x, z: c.z, opened: c.opened, items: c.items })),
      };
    },
    load(d) {
      this.t = d.t; this.lastHour = d.t;
      for (const id in d.npcs) {
        const s = d.npcs[id], n = this.npcs[id];
        if (!n) continue;
        const inv = s.inv; delete s.inv;
        Object.assign(n, s);
        n.inv.load(inv);
        if (!n.alive) n.state = 'dead', n.deadT = 999;
      }
      for (const id in d.factions) Object.assign(this.factions[id], d.factions[id]);
      this.log = d.log || []; this.quests = d.quests || []; this.killsByBuilding = d.killsByBuilding || {}; this.flags = d.flags || {};
      Object.assign(this.base, d.base, { storage: this.base.storage });
      this.base.storage.load(d.base.storage);
      const byId = {}; TW.containers.forEach((c) => { byId[c.id] = c; });
      (d.containers || []).forEach((c) => { const o = byId[c.id]; if (o) { o.opened = true; o.items = c.items; } });
      const doorById = {}; TW.doors.forEach((x) => { doorById[x.id] = x; });
      (d.doors || []).forEach((x) => { const o = doorById[x.id]; if (o) Object.assign(o, x); });
      this.crates = (d.crates || []).filter((c) => !c.opened).map((c) => ({ id: c.id, name: 'Caixa de suprimentos', kind: 'container', loot: 'caixa_suprimentos', x: c.x, z: c.z, x0: c.x - 0.6, x1: c.x + 0.6, z0: c.z - 0.6, z1: c.z + 0.6, y0: TW.ELEV, y1: TW.ELEV + 1, opened: false, items: c.items, room: { locked: false }, color: [0.3, 0.45, 0.3], crate: true }));
      this.agents = this.agents.filter((a) => a.kind !== 'npc' || a.alive || a.deadT < 60);
    },
  };

  FS.Sim = Sim;
  FS.SimData = { ROSTER, FACTIONS, SPEC_NAME };
})(typeof window !== 'undefined' ? window : globalThis);
