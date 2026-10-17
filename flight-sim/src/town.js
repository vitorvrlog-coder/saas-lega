/* town.js — "Vila Esperança": cidade explorável (dados puros, sem THREE).
 * Prédios modulares com andares, escadas, portas, janelas, salas e móveis com saque;
 * colisão (paredes AABB + superfícies caminháveis), linha de visada e navegação (grade + A*).
 * Coordenadas do mundo (x leste, y altura, z sul). */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const T = FS.Terrain;

  const X0 = -380, Z0 = 1050, SIZE = 400, ELEV = 45;
  const H = 3.2, FOFF = 0.12, WT = 0.22, STEP = 0.55;
  T.addFlatZone({ x0: X0 - 30, x1: X0 + SIZE + 30, z0: Z0 - 30, z1: Z0 + SIZE + 30, elev: ELEV, blend: 450 });
  // estrada ligando os hangares do aeroporto à vila
  T.straightRoad([-420 + 0, 470 + 60], [X0 + 200, Z0 + 2], 12);

  const walls = [], surfaces = [], doors = [], containers = [], buildings = [], windows = [], props = [], streets = [];
  const CELL = 8;
  const hashWalls = new Map(), hashSurf = new Map();
  const key = (i, j) => i * 73856 + j;
  function hashAdd(map, o) {
    const i0 = Math.floor(o.x0 / CELL), i1 = Math.floor(o.x1 / CELL), j0 = Math.floor(o.z0 / CELL), j1 = Math.floor(o.z1 / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j); let a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(o);
    }
  }
  function addWall(o) { walls.push(o); hashAdd(hashWalls, o); return o; }
  function addSurface(o) { surfaces.push(o); hashAdd(hashSurf, o); return o; }

  /* ------------------------------------------------------------ definição da vila */
  // lx, lz = canto mínimo em coordenadas locais da vila; front = lado da porta (N = -z, S = +z)
  const BUILDING_DEFS = [
    { id: 'hosp', name: 'Hospital São Lucas', type: 'hospital', lx: 215, lz: 150, w: 40, d: 22, floors: 2, front: 'S', nx: 5, nz: 2, color: [0.86, 0.87, 0.86], faction: 'clinica', locked: { i: 0, j: 1, key: 'crowbar', label: 'Farmácia' } },
    { id: 'mercado', name: 'Supermercado Bom Preço', type: 'market', lx: 95, lz: 150, w: 32, d: 26, floors: 1, front: 'S', nx: 1, nz: 1, storage: true, color: [0.78, 0.62, 0.45] },
    { id: 'policia', name: 'Delegacia de Polícia', type: 'police', lx: 300, lz: 158, w: 26, d: 18, floors: 1, front: 'S', nx: 3, nz: 2, color: [0.55, 0.62, 0.75], locked: { i: 0, j: 1, key: 'chave_arsenal', label: 'Arsenal' } },
    { id: 'aurora', name: 'Edifício Aurora', type: 'apartment', lx: 100, lz: 40, w: 18, d: 18, floors: 4, roof: true, front: 'S', nx: 2, nz: 2, color: [0.74, 0.66, 0.6] },
    { id: 'casaA', name: 'Casa da Rua das Flores', type: 'house', lx: 30, lz: 150, w: 12, d: 13, floors: 2, front: 'S', nx: 2, nz: 1, color: [0.85, 0.78, 0.62] },
    { id: 'casaB', name: 'Casa Azul', type: 'house', lx: 30, lz: 45, w: 12, d: 13, floors: 2, front: 'S', nx: 2, nz: 1, color: [0.55, 0.68, 0.8] },
    { id: 'oficina', name: 'Oficina Mecânica do Zé', type: 'workshop', lx: 215, lz: 222, w: 22, d: 16, floors: 1, front: 'N', nx: 1, nz: 1, garage: true, storage: true, color: [0.62, 0.6, 0.55] },
    { id: 'posto', name: 'Loja do Posto Estrela', type: 'gas', lx: 318, lz: 246, w: 12, d: 9, floors: 1, front: 'N', nx: 1, nz: 1, color: [0.9, 0.85, 0.75], faction: 'mercadores' },
    { id: 'galpao', name: 'Galpão Logístico', type: 'warehouse', lx: 30, lz: 300, w: 30, d: 20, floors: 1, front: 'N', nx: 1, nz: 1, storage: true, color: [0.5, 0.5, 0.52], faction: 'corvos' },
    { id: 'casaC', name: 'Casa Amarela', type: 'house', lx: 110, lz: 222, w: 12, d: 13, floors: 2, front: 'N', nx: 2, nz: 1, color: [0.92, 0.82, 0.45] },
    { id: 'casaD', name: 'Casa de Esquina', type: 'house', lx: 110, lz: 320, w: 12, d: 13, floors: 1, front: 'N', nx: 2, nz: 2, color: [0.8, 0.6, 0.55] },
    { id: 'casaE', name: 'Sobrado Verde', type: 'house', lx: 215, lz: 320, w: 13, d: 13, floors: 2, front: 'N', nx: 2, nz: 1, color: [0.6, 0.75, 0.6] },
  ];

  const LOOT_BY_TYPE = {
    house: ['casa_cozinha', 'casa_quarto', 'casa_banheiro', 'casa_geral'],
    apartment: ['casa_cozinha', 'casa_quarto', 'casa_geral', 'casa_banheiro'],
    hospital: ['hosp_remedios', 'hosp_remedios', 'hosp_geral'],
    market: ['mercado_comida', 'mercado_comida', 'mercado_geral'],
    police: ['policia_armario', 'policia_geral'],
    workshop: ['oficina_ferramentas', 'oficina_pecas'],
    gas: ['posto_loja', 'posto_combustivel'],
    warehouse: ['galpao_materiais', 'galpao_geral'],
  };
  const CONTAINER_KIND = {
    casa_cozinha: ['Armário da cozinha', 0.9, 0.6, 2.0, [0.62, 0.45, 0.3]],
    casa_quarto: ['Guarda-roupa', 1.2, 0.6, 2.0, [0.5, 0.36, 0.25]],
    casa_banheiro: ['Armário do banheiro', 0.7, 0.4, 1.6, [0.9, 0.9, 0.88]],
    casa_geral: ['Gaveteiro', 0.9, 0.5, 1.0, [0.55, 0.42, 0.3]],
    hosp_remedios: ['Armário de medicamentos', 1.2, 0.5, 1.9, [0.85, 0.88, 0.92]],
    hosp_geral: ['Carrinho hospitalar', 0.8, 0.6, 1.1, [0.7, 0.75, 0.8]],
    mercado_comida: ['Prateleira de alimentos', 2.4, 0.8, 1.8, [0.75, 0.3, 0.25]],
    mercado_geral: ['Prateleira de utilidades', 2.4, 0.8, 1.8, [0.3, 0.45, 0.7]],
    policia_armario: ['Armário de equipamentos', 1.0, 0.6, 2.0, [0.35, 0.4, 0.45]],
    policia_geral: ['Mesa de investigação', 1.4, 0.8, 0.85, [0.45, 0.35, 0.25]],
    policia_arsenal: ['Cofre de armas', 1.4, 0.7, 1.9, [0.25, 0.27, 0.3]],
    oficina_ferramentas: ['Caixa de ferramentas', 1.2, 0.6, 1.1, [0.8, 0.2, 0.15]],
    oficina_pecas: ['Estante de peças', 2.0, 0.6, 2.0, [0.4, 0.4, 0.42]],
    posto_loja: ['Gôndola da loja', 1.8, 0.7, 1.5, [0.85, 0.75, 0.2]],
    posto_combustivel: ['Galões de combustível', 1.0, 0.8, 0.9, [0.8, 0.15, 0.1]],
    galpao_materiais: ['Pallet de materiais', 1.6, 1.2, 1.3, [0.6, 0.48, 0.3]],
    galpao_geral: ['Contêiner de carga', 2.0, 1.0, 1.5, [0.3, 0.5, 0.4]],
    hosp_farmacia: ['Estoque da farmácia', 1.6, 0.6, 2.0, [0.9, 0.92, 0.95]],
  };

  /* ------------------------------------------------------------------ construção */
  function buildBuilding(def) {
    const w = def.w, d = def.d, nfl = def.floors;
    const b = Object.assign({}, def);
    b.x0 = X0 + def.lx; b.z0 = Z0 + def.lz; b.x1 = b.x0 + w; b.z1 = b.z0 + d;
    b.rooms = []; b.doors = []; b.windows = []; b.parts = []; b.containers = [];
    b.floorY = (k) => ELEV + FOFF + k * H;
    b.topY = b.floorY(nfl);
    b.hasStairs = nfl > 1 || !!def.roof;
    const S = def.front === 'S';
    const tr = (lx, lz) => (S ? [b.x0 + w - lx, b.z0 + d - lz] : [b.x0 + lx, b.z0 + lz]);
    const boxW = (lx0, lx1, lz0, lz1) => {
      const a = tr(lx0, lz0), c = tr(lx1, lz1);
      return { x0: Math.min(a[0], c[0]), x1: Math.max(a[0], c[0]), z0: Math.min(a[1], c[1]), z1: Math.max(a[1], c[1]) };
    };
    const part = (lx0, lx1, lz0, lz1, y0, y1, color, kind, floor) => {
      const bx = boxW(lx0, lx1, lz0, lz1);
      const o = addWall(Object.assign(bx, { y0, y1, kind: kind || 'wall', bid: b.id, floor, color }));
      b.parts.push(o);
      return o;
    };
    const colOut = def.color, colIn = [0.88, 0.86, 0.8];
    // escada
    // escada alinhada à grade de navegação (1 m): pista A = rampa, pista B = passagem
    const st = { ax0: w - 4.85, ax1: w - 2.2, zBot: d - 7.0, zTop: d - 2.0, cellX: w - 5.0, cellZ: d - 8.2 };
    const L = st.zTop - st.zBot;
    st.hole0 = st.zBot + 0.4 * L;
    b.stairLocal = st;
    const inStairCell = (lx, lz) => b.hasStairs && lx > st.cellX - 0.05 && lz > st.cellZ - 0.05;

    const sideLen = { front: w, back: w, left: d, right: d };
    for (let k = 0; k <= nfl; k++) {
      const y = b.floorY(k);
      const roofLevel = k === nfl;
      /* --- piso / laje --- */
      const slabs = [];
      if (k >= 1 && b.hasStairs && (k < nfl || def.roof)) {
        // laje com abertura sobre a escada (pista A)
        slabs.push([0, st.ax0, 0, d], [st.ax1, w, 0, d], [st.ax0, st.ax1, 0, st.hole0], [st.ax0, st.ax1, st.zTop, d]);
      } else slabs.push([0, w, 0, d]);
      slabs.forEach((r) => {
        const bx = boxW(r[0], r[1], r[2], r[3]);
        const s = addSurface(Object.assign(bx, { y, bid: b.id, floor: k, roof: roofLevel }));
        b.parts.push({ x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, y0: y - 0.25, y1: y, kind: roofLevel ? 'roof' : 'slab', floor: k, bid: b.id, color: roofLevel ? [0.35, 0.33, 0.32] : k === 0 ? [0.55, 0.5, 0.45] : [0.6, 0.58, 0.55] });
        // lajes também ocluem a visão (paredes "horizontais")
        if (k > 0) addWall({ x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, y0: y - 0.25, y1: y - 0.02, kind: 'slab', bid: b.id, floor: k, noCollide: true });
      });
      if (roofLevel) {
        if (def.roof) {
          const ph = 1.0;
          part(0, w, 0, WT, y, y + ph, colOut, 'parapet', k); part(0, w, d - WT, d, y, y + ph, colOut, 'parapet', k);
          part(0, WT, 0, d, y, y + ph, colOut, 'parapet', k); part(w - WT, w, 0, d, y, y + ph, colOut, 'parapet', k);
          // guarda-corpo em volta da abertura
          part(st.ax0 - 0.12, st.ax0, st.hole0, st.zTop, y, y + 1.0, [0.3, 0.3, 0.3], 'rail', k);
          part(st.ax1, st.ax1 + 0.12, st.hole0, st.zTop, y, y + 1.0, [0.3, 0.3, 0.3], 'rail', k);
        }
        continue;
      }
      /* --- paredes externas com portas e janelas --- */
      const sides = [
        { name: 'front', fixed: 0, along: 'x' }, { name: 'back', fixed: d - WT, along: 'x' },
        { name: 'left', fixed: 0, along: 'z' }, { name: 'right', fixed: w - WT, along: 'z' },
      ];
      sides.forEach((sd) => {
        const len = sideLen[sd.name];
        const ops = [];
        if (k === 0 && sd.name === 'front') {
          const dw = def.garage ? 4.2 : 1.6;
          // porta no centro da primeira sala (longe das divisórias), alinhada à grade de navegação
          const dc = def.nx > 1 ? Math.floor(w / def.nx / 2) + 0.5 : Math.floor(len / 2) + 0.5;
          ops.push({ a: dc - dw / 2, b: dc + dw / 2, type: 'door', top: def.garage ? 3.0 : 2.3, main: true });
        }
        // janelas
        const n = Math.floor((len - 1.5) / 4.2);
        for (let i = 0; i < n; i++) {
          const c = (len / (n + 1)) * (i + 1);
          const a = c - 0.75, bb = c + 0.75;
          if (ops.some((o) => bb > o.a - 0.5 && a < o.b + 0.5)) continue;
          // não colocar janela na parede da escada
          if (b.hasStairs && sd.name === 'right' && bb > st.cellZ) continue;
          if (b.hasStairs && sd.name === 'back' && bb > st.cellX) continue;
          if (def.type === 'warehouse' && k === 0 && sd.name !== 'front') continue;
          ops.push({ a, b: bb, type: 'window', sill: def.type === 'market' && sd.name === 'front' ? 0.3 : 1.0, top: 2.3 });
        }
        ops.sort((p, q) => p.a - q.a);
        let pos = 0;
        const seg = (a, bb, y0, y1, kind) => {
          if (bb - a < 0.02 || y1 - y0 < 0.02) return;
          if (sd.along === 'x') part(a, bb, sd.fixed, sd.fixed + WT, y0, y1, colOut, kind || 'wall', k);
          else part(sd.fixed, sd.fixed + WT, a, bb, y0, y1, colOut, kind || 'wall', k);
        };
        ops.forEach((o) => {
          seg(pos, o.a, y, y + H);
          if (o.type === 'window') {
            seg(o.a, o.b, y, y + o.sill); seg(o.a, o.b, y + o.top, y + H);
            const c = sd.along === 'x' ? tr((o.a + o.b) / 2, sd.fixed + WT / 2) : tr(sd.fixed + WT / 2, (o.a + o.b) / 2);
            let nrm = sd.name === 'front' ? [0, -1] : sd.name === 'back' ? [0, 1] : sd.name === 'left' ? [-1, 0] : [1, 0];
            if (S) nrm = [-nrm[0], -nrm[1]];
            const win = { bid: b.id, floor: k, x: c[0], z: c[1], y0: y + o.sill, y1: y + o.top, nx: nrm[0], nz: nrm[1], width: o.b - o.a, alongX: (sd.along === 'x') !== false, broken: M.hash2(Math.round(c[0] * 7), Math.round(c[1] * 7), 5) < 0.3 };
            win.alongWorldX = sd.along === 'x';
            windows.push(win); b.windows.push(win);
          } else {
            seg(o.a, o.b, y + o.top, y + H);
            const bx = sd.along === 'x' ? boxW(o.a, o.b, sd.fixed + 0.05, sd.fixed + WT - 0.05) : boxW(sd.fixed + 0.05, sd.fixed + WT - 0.05, o.a, o.b);
            const door = makeDoor(b, bx, y, y + o.top, def.garage && o.main ? 'Portão da garagem' : 'Porta de entrada', null, sd.along === 'x', k);
            door.main = true;
            const c = sd.along === 'x' ? tr((o.a + o.b) / 2, -1.2) : tr(-1.2, (o.a + o.b) / 2);
            b.entrance = { x: c[0], z: c[1] };
            const ci = sd.along === 'x' ? tr((o.a + o.b) / 2, 1.5) : tr(1.5, (o.a + o.b) / 2);
            b.inside = { x: ci[0], z: ci[1] };
          }
          pos = o.b;
        });
        seg(pos, len, y, y + H);
      });
      /* --- divisórias internas (salas) --- */
      const xs = [0], zs = [0];
      for (let i = 1; i < def.nx; i++) xs.push(+(w * i / def.nx).toFixed(2));
      for (let j = 1; j < def.nz; j++) zs.push(+(d * j / def.nz).toFixed(2));
      xs.push(w); zs.push(d);
      if (def.storage && k === 0) zs.splice(zs.length - 1, 0, d - 6);
      const lockedRoom = k === 0 && def.locked ? def.locked : null;
      const gapLocked = (lineX, a, bb) => {
        if (!lockedRoom) return false;
        const rx0 = xs[lockedRoom.i], rx1 = xs[lockedRoom.i + 1], rz0 = zs[lockedRoom.j], rz1 = zs[lockedRoom.j + 1];
        if (lineX !== null) return (Math.abs(lineX - rx0) < 0.01 || Math.abs(lineX - rx1) < 0.01) && a >= rz0 - 0.01 && bb <= rz1 + 0.01;
        return false;
      };
      const gapLockedZ = (lineZ, a, bb) => {
        if (!lockedRoom) return false;
        const rx0 = xs[lockedRoom.i], rx1 = xs[lockedRoom.i + 1], rz0 = zs[lockedRoom.j], rz1 = zs[lockedRoom.j + 1];
        return (Math.abs(lineZ - rz0) < 0.01 || Math.abs(lineZ - rz1) < 0.01) && a >= rx0 - 0.01 && bb <= rx1 + 0.01;
      };
      const partition = (alongX, fixed, a, bb, locked) => {
        // recorta a célula da escada
        if (b.hasStairs) {
          // mantém livre a frente da caixa da escada
          if (alongX && fixed > st.cellZ - 2.5) bb = Math.min(bb, st.cellX - (fixed > st.cellZ - 0.05 ? 0 : 0.2));
          if (!alongX && fixed > st.cellX - 2.5) bb = Math.min(bb, st.cellZ - (fixed > st.cellX - 0.05 ? 0 : 0.2));
        }
        if (bb - a < 1.2) return;
        const len = bb - a;
        const gw = 1.6;
        // vão alinhado à grade; perto da caixa da escada fica na parte livre da parede
        let ga0 = a, gb0 = bb;
        if (b.hasStairs) {
          if (!alongX && fixed > st.cellX - 3 && bb > st.cellZ) gb0 = Math.min(bb, st.cellZ - 0.3);
          if (alongX && fixed > st.cellZ - 3 && bb > st.cellX) gb0 = Math.min(bb, st.cellX - 0.3);
          if (gb0 - ga0 < 2) { ga0 = a; gb0 = bb; }
        }
        const gc = Math.floor((ga0 + gb0) / 2) + 0.5;
        const ga = gc - gw / 2, gb = ga + gw;
        const th = 0.14;
        const mk = (p, q) => {
          if (q - p < 0.05) return;
          if (alongX) part(p, q, fixed - th / 2, fixed + th / 2, y, y + H, colIn, 'inner', k);
          else part(fixed - th / 2, fixed + th / 2, p, q, y, y + H, colIn, 'inner', k);
        };
        if (len < 2.4) { mk(a, bb); return; }
        mk(a, ga); mk(gb, bb);
        part(...(alongX ? [ga, gb, fixed - th / 2, fixed + th / 2] : [fixed - th / 2, fixed + th / 2, ga, gb]), y + 2.2, y + H, colIn, 'inner', k);
        if (locked) {
          const bx = alongX ? boxW(ga, gb, fixed - 0.05, fixed + 0.05) : boxW(fixed - 0.05, fixed + 0.05, ga, gb);
          const dr = makeDoor(b, bx, y, y + 2.2, lockedRoom.label, lockedRoom.key, alongX, k);
          dr.locked = lockedRoom.key;
        }
      };
      for (let i = 1; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) partition(false, xs[i], zs[j], zs[j + 1], gapLocked(xs[i], zs[j], zs[j + 1]));
      for (let j = 1; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) partition(true, zs[j], xs[i], xs[i + 1], gapLockedZ(zs[j], xs[i], xs[i + 1]));
      /* --- escada --- */
      if (b.hasStairs) {
        part(st.cellX, st.cellX + 0.15, st.cellZ, d, y, y + H, colIn, 'inner', k);
        part(st.ax1, st.ax1 + 0.2, st.zBot, st.zTop, y, y + H, colIn, 'inner', k);
        if (k < nfl - 1 || (def.roof && k === nfl - 1)) {
          const a = tr(st.ax0, st.zBot), c = tr(st.ax1, st.zTop);
          const ramp = addSurface({ x0: Math.min(a[0], c[0]), x1: Math.max(a[0], c[0]), z0: Math.min(a[1], c[1]), z1: Math.max(a[1], c[1]),
            ramp: true, za: a[1], ya: y, zb: c[1], yb: y + H, bid: b.id, floor: k });
          b.parts.push({ ramp, kind: 'ramp', floor: k, bid: b.id });
        } else if (k >= 1) {
          part(st.ax0, st.ax1, st.hole0 - 0.12, st.hole0, y, y + 1.0, [0.3, 0.3, 0.3], 'rail', k);
        }
      }
      /* --- salas e móveis com saque --- */
      for (let i = 0; i < xs.length - 1; i++) {
        for (let j = 0; j < zs.length - 1; j++) {
          const rx0 = xs[i], rx1 = xs[i + 1], rz0 = zs[j], rz1 = zs[j + 1];
          const room = { bid: b.id, floor: k, i, j, locked: lockedRoom && lockedRoom.i === i && lockedRoom.j === j };
          const c0 = tr(rx0, rz0), c1 = tr(rx1, rz1);
          Object.assign(room, { x0: Math.min(c0[0], c1[0]), x1: Math.max(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), z1: Math.max(c0[1], c1[1]), y });
          b.rooms.push(room);
          placeContainers(b, room, rx0, rx1, rz0, rz1, k, tr, inStairCell);
        }
      }
    }
    buildings.push(b);
    return b;
  }

  let doorSeq = 0;
  function makeDoor(b, bx, y0, y1, name, lock, alongX, floor) {
    const door = Object.assign({ id: 'door' + doorSeq++, bid: b.id, y0, y1, name, open: false, locked: lock || null, alongWorldX: undefined, anim: 0, floor, kind: 'door' }, bx);
    door.alongWorldX = (bx.x1 - bx.x0) > (bx.z1 - bx.z0);
    doors.push(door); b.doors.push(door);
    hashAdd(hashWalls, door);
    return door;
  }

  let contSeq = 0;
  function placeContainers(b, room, rx0, rx1, rz0, rz1, k, tr, inStairCell) {
    const rng = M.mulberry32(contSeq * 977 + b.id.length * 31 + k * 7 + room.i * 13 + room.j * 17);
    const types = LOOT_BY_TYPE[b.type] || ['casa_geral'];
    const big = (rx1 - rx0) * (rz1 - rz0) > 200;
    const corners = [[rx0, rz0, 1, 1], [rx1, rz0, -1, 1], [rx0, rz1, 1, -1], [rx1, rz1, -1, -1]];
    let count = room.locked ? 1 : big ? 6 : 1 + Math.floor(rng() * 2);
    const spots = [];
    if (big) {
      // corredores de prateleiras em salões grandes
      const nRows = Math.max(1, Math.floor((rz1 - rz0 - 6) / 4));
      for (let r = 0; r < nRows && spots.length < 8; r++) {
        const zz = rz0 + 4 + r * 4;
        spots.push([rx0 + (rx1 - rx0) * 0.3, zz, 0, 0, true], [rx0 + (rx1 - rx0) * 0.7, zz, 0, 0, true]);
      }
      count = spots.length;
    } else {
      corners.sort(() => rng() - 0.5).forEach((c) => spots.push(c));
    }
    let placed = 0;
    for (const sp of spots) {
      if (placed >= count) break;
      const typeKey = room.locked ? (b.type === 'police' ? 'policia_arsenal' : 'hosp_farmacia') : types[Math.floor(rng() * types.length)];
      const kd = CONTAINER_KIND[typeKey];
      const cw = kd[1], cd = kd[2], ch = kd[3];
      let lx, lz, w2, d2;
      if (sp[4]) { lx = sp[0]; lz = sp[1]; w2 = Math.min(cw * 2.2, (rx1 - rx0) * 0.3); d2 = cd; }
      else {
        // encostado na parede (gira para ficar alinhado com a parede mais próxima)
        const alongX = rng() < 0.5;
        w2 = alongX ? cw : cd; d2 = alongX ? cd : cw;
        lx = sp[0] + sp[2] * (0.35 + w2 / 2); lz = sp[1] + sp[3] * (0.35 + d2 / 2);
      }
      if (inStairCell(lx, lz) || inStairCell(lx + w2 / 2, lz + d2 / 2)) continue;
      // evita bloquear a porta principal
      if (k === 0 && Math.abs(lx - b.w / 2) < 2.4 && lz < 3) continue;
      const a = tr(lx - w2 / 2, lz - d2 / 2), c = tr(lx + w2 / 2, lz + d2 / 2);
      const y = b.floorY(k);
      const cont = {
        id: 'c' + contSeq++, bid: b.id, floor: k, kind: 'container', name: kd[0], loot: typeKey, color: kd[4],
        x0: Math.min(a[0], c[0]), x1: Math.max(a[0], c[0]), z0: Math.min(a[1], c[1]), z1: Math.max(a[1], c[1]), y0: y, y1: y + ch,
        opened: false, items: null, room,
      };
      cont.x = (cont.x0 + cont.x1) / 2; cont.z = (cont.z0 + cont.z1) / 2;
      containers.push(cont); b.containers.push(cont);
      addWall(cont);
      placed++;
    }
  }

  BUILDING_DEFS.forEach(buildBuilding);
  const byId = {};
  buildings.forEach((b) => { byId[b.id] = b; });

  /* ------------------------------------------------------------- ruas e objetos */
  const L = (x, z) => [X0 + x, Z0 + z];
  // avenida leste-oeste e ruas
  streets.push({ x0: X0, x1: X0 + SIZE, z0: Z0 + 193, z1: Z0 + 207, main: true });
  streets.push({ x0: X0 + 194, x1: X0 + 206, z0: Z0, z1: Z0 + SIZE, main: true });
  streets.push({ x0: X0, x1: X0 + 300, z0: Z0 + 120, z1: Z0 + 130 });
  streets.push({ x0: X0, x1: X0 + 320, z0: Z0 + 285, z1: Z0 + 295 });
  streets.push({ x0: X0 + 85, x1: X0 + 93, z0: Z0 + 20, z1: Z0 + 380 });
  streets.push({ x0: X0 + 290, x1: X0 + 298, z0: Z0 + 120, z1: Z0 + 300 });

  function addProp(p) {
    props.push(p);
    if (p.solid !== false) addWall({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, y0: ELEV, y1: ELEV + p.h, kind: 'prop', prop: p });
    return p;
  }
  // carros abandonados
  const carRng = M.mulberry32(42);
  const carSpots = [[60, 198, true], [150, 202, true], [240, 196, true], [340, 203, true], [200, 60, false], [198, 330, false], [88, 250, false], [293, 140, false]];
  carSpots.forEach((c, i) => {
    const [lx, lz, alongX] = c;
    const [x, z] = L(lx, lz);
    const hw = alongX ? 2.2 : 0.95, hd = alongX ? 0.95 : 2.2;
    addProp({ type: 'wreck', x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd, h: 1.5, color: [[0.6, 0.15, 0.12], [0.2, 0.3, 0.5], [0.75, 0.75, 0.72], [0.2, 0.22, 0.2]][i % 4], alongX, burnt: carRng() < 0.3 });
  });
  // posto: cobertura e bombas
  (function () {
    const [x, z] = L(316, 214);
    addProp({ type: 'canopy', x0: x, x1: x + 22, z0: z, z1: z + 14, h: 5.2, solid: false });
    [[322, 221], [334, 221]].forEach((p) => { const [px, pz] = L(p[0], p[1]); addProp({ type: 'pump', x0: px - 0.5, x1: px + 0.5, z0: pz - 0.4, z1: pz + 0.4, h: 1.7, interact: 'fuel' }); });
    [[316, 214], [338, 214], [316, 228], [338, 228]].forEach((p) => { const [px, pz] = L(p[0], p[1]); addProp({ type: 'pillar', x0: px - 0.25, x1: px + 0.25, z0: pz - 0.25, z1: pz + 0.25, h: 5.2 }); });
  })();
  // Comunidade Colina Verde: cerca, barracas, horta e gerador
  const camp = { x0: X0 + 320, x1: X0 + 392, z0: Z0 + 310, z1: Z0 + 392, gate: { x: X0 + 356, z: Z0 + 310 } };
  (function () {
    const t = 0.25, h = 2.4;
    const fence = (x0, x1, z0, z1) => addProp({ type: 'fence', x0, x1, z0, z1, h });
    fence(camp.x0, camp.gate.x - 2.5, camp.z0 - t, camp.z0 + t);
    fence(camp.gate.x + 2.5, camp.x1, camp.z0 - t, camp.z0 + t);
    fence(camp.x0, camp.x1, camp.z1 - t, camp.z1 + t);
    fence(camp.x0 - t, camp.x0 + t, camp.z0, camp.z1);
    fence(camp.x1 - t, camp.x1 + t, camp.z0, camp.z1);
    [[330, 325], [345, 325], [372, 325], [385, 325], [330, 345]].forEach((p, i) => {
      const [x, z] = L(p[0], p[1]);
      addProp({ type: 'tent', x0: x - 2.2, x1: x + 2.2, z0: z - 2.5, z1: z + 2.5, h: 2.3, color: [[0.3, 0.45, 0.3], [0.55, 0.45, 0.3], [0.25, 0.35, 0.5], [0.5, 0.3, 0.25], [0.4, 0.4, 0.35]][i] });
    });
    const [gx, gz] = L(386, 382);
    addProp({ type: 'generator', x0: gx - 1, x1: gx + 1, z0: gz - 0.7, z1: gz + 0.7, h: 1.3, interact: 'generator' });
    const [fx, fz] = L(345, 360);
    addProp({ type: 'field', x0: fx, x1: fx + 30, z0: fz, z1: fz + 22, h: 0.3, solid: false });
  })();
  // barricadas dos Corvos em frente ao galpão
  (function () {
    const g = byId.galpao;
    addProp({ type: 'barricade', x0: g.x0 - 6, x1: g.x0 + 8, z0: g.z0 - 9, z1: g.z0 - 8.2, h: 1.3 });
    addProp({ type: 'barricade', x0: g.x0 + 22, x1: g.x1 + 6, z0: g.z0 - 9, z1: g.z0 - 8.2, h: 1.3 });
  })();
  // postes de luz ao longo da avenida
  const lamps = [];
  for (let x = 20; x < SIZE; x += 45) { const [lx, lz] = L(x, 190); lamps.push({ x: lx, z: lz }); addProp({ type: 'lamp', x0: lx - 0.15, x1: lx + 0.15, z0: lz - 0.15, z1: lz + 0.15, h: 6 }); }

  /* --------------------------------------------------------------- consultas */
  function surfaceTop(s, x, z) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return null;
    if (!s.ramp) return s.y;
    const t = (z - s.za) / (s.zb - s.za);
    return M.lerp(s.ya, s.yb, M.clamp(t, 0, 1));
  }
  const inTown = (x, z) => x > X0 - 60 && x < X0 + SIZE + 60 && z > Z0 - 60 && z < Z0 + SIZE + 60;

  // altura do chão sob (x,z) para quem está com os pés em yFeet
  function groundAt(x, z, yFeet) {
    let best = inTown(x, z) ? ELEV : T.groundHeight(x, z);
    const cell = hashSurf.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (cell) {
      for (let i = 0; i < cell.length; i++) {
        const top = surfaceTop(cell[i], x, z);
        if (top !== null && top <= yFeet + STEP && top > best) best = top;
      }
    }
    return best;
  }

  const solid = (o) => !o.noCollide && (o.kind !== 'door' || (!o.open));
  // empurra um círculo (raio r) para fora das paredes que cruzam a faixa vertical do corpo
  function collideCircle(x, z, yFeet, r, height) {
    const yb = yFeet + 0.35, yt = yFeet + (height || 1.7);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
      const seen = new Set();
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const cell = hashWalls.get(key(i, j));
        if (!cell) continue;
        for (let n = 0; n < cell.length; n++) {
          const w = cell[n];
          if (seen.has(w)) continue; seen.add(w);
          if (!solid(w) || w.y1 < yb || w.y0 > yt) continue;
          const cx = M.clamp(x, w.x0, w.x1), cz = M.clamp(z, w.z0, w.z1);
          let dx = x - cx, dz = z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-8) {
            const dd = Math.sqrt(d2);
            x = cx + (dx / dd) * r; z = cz + (dz / dd) * r;
          } else {
            // centro dentro da caixa: sai pelo lado mais próximo
            const pl = [x - w.x0, w.x1 - x, z - w.z0, w.z1 - z];
            const m = Math.min(...pl);
            if (m === pl[0]) x = w.x0 - r; else if (m === pl[1]) x = w.x1 + r; else if (m === pl[2]) z = w.z0 - r; else z = w.z1 + r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  // linha de visada entre dois pontos 3D (paredes, portas fechadas, lajes)
  function losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = ax + dx * t, cz = az + dz * t;
      const cell = hashWalls.get(key(Math.floor(cx / CELL), Math.floor(cz / CELL)));
      if (!cell) continue;
      for (let n = 0; n < cell.length; n++) {
        const w = cell[n];
        if (seen.has(w)) continue; seen.add(w);
        if (w.kind === 'door' && w.open) continue;
        if (w.kind === 'container' || w.kind === 'prop' && w.prop && w.prop.h < 1.6) continue;
        if (segBox(ax, ay, az, dx, dy, dz, w)) return false;
      }
    }
    return true;
  }
  function segBox(ax, ay, az, dx, dy, dz, b) {
    let t0 = 0, t1 = 1;
    const ax_ = [ax, ay, az], d = [dx, dy, dz], mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (ax_[i] < mn[i] || ax_[i] > mx[i]) return false; continue; }
      let ta = (mn[i] - ax_[i]) / d[i], tb = (mx[i] - ax_[i]) / d[i];
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return t1 > 0.001 && t0 < 0.999;
  }

  function buildingAt(x, z) {
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    }
    return null;
  }
  function floorOf(b, y) { return M.clamp(Math.round((y - b.floorY(0)) / H), 0, b.floors); }

  /* ------------------------------------------------------------------ navegação */
  const NAV = { levels: [], links: new Map(), total: 0 };
  const PAD = 20;
  function addLevel(lv) { lv.offset = NAV.total; lv.cells = new Uint8Array(lv.nx * lv.nz); NAV.total += lv.nx * lv.nz; lv.index = NAV.levels.length; NAV.levels.push(lv); return lv; }
  const ground = addLevel({ x0: X0 - PAD, z0: Z0 - PAD, nx: SIZE + 2 * PAD, nz: SIZE + 2 * PAD, y: ELEV, bid: null, floor: 0 });
  buildings.forEach((b) => {
    b.levels = [ground];
    const top = b.roof ? b.floors : b.floors - 1;
    for (let k = 1; k <= top; k++) b.levels[k] = addLevel({ x0: Math.floor(b.x0), z0: Math.floor(b.z0), nx: Math.ceil(b.x1) - Math.floor(b.x0), nz: Math.ceil(b.z1) - Math.floor(b.z0), y: b.floorY(k), bid: b.id, floor: k });
  });
  const doorCells = new Map();   // nó -> porta
  function rasterize(lv, o, val, pad) {
    // células cujo quadrado (1 m) intercepta a caixa
    const i0 = Math.max(0, Math.floor(o.x0 - pad - lv.x0)), i1 = Math.min(lv.nx - 1, Math.ceil(o.x1 + pad - lv.x0) - 1);
    const j0 = Math.max(0, Math.floor(o.z0 - pad - lv.z0)), j1 = Math.min(lv.nz - 1, Math.ceil(o.z1 + pad - lv.z0) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const id = j * lv.nx + i;
      if (val === 2) { if (lv.cells[id] !== 1) { lv.cells[id] = 2; doorCells.set(lv.offset + id, o); } }
      else lv.cells[id] = val;
    }
  }
  function buildNav() {
    NAV.levels.forEach((lv) => {
      lv.cells.fill(lv === ground ? 0 : 1);
      if (lv !== ground) {
        // células com piso real
        const b = byId[lv.bid];
        for (let j = 0; j < lv.nz; j++) for (let i = 0; i < lv.nx; i++) {
          const x = lv.x0 + i + 0.5, z = lv.z0 + j + 0.5;
          let ok = false;
          for (const s of surfaces) if (s.bid === b.id && s.floor === lv.floor && !s.ramp && x >= s.x0 + 0.3 && x <= s.x1 - 0.3 && z >= s.z0 + 0.3 && z <= s.z1 - 0.3) { ok = true; break; }
          lv.cells[j * lv.nx + i] = ok ? 0 : 1;
        }
      }
      const yb = lv.y + 0.35, yt = lv.y + 1.7;
      walls.forEach((w) => {
        if (w.noCollide || w.y1 < yb || w.y0 > yt) return;
        if (lv !== ground && w.bid !== lv.bid) return;
        rasterize(lv, w, 1, 0);
      });
      doors.forEach((d) => { if (d.y0 < yt && d.y1 > yb && (lv === ground ? d.floor === 0 : d.bid === lv.bid && d.floor === lv.floor)) rasterize(lv, d, 2, 0); });
    });
    // rampas: bloqueiam o próprio nível e criam ligações entre andares
    NAV.links.clear();
    buildings.forEach((b) => {
      if (!b.hasStairs) return;
      surfaces.filter((s) => s.ramp && s.bid === b.id).forEach((s) => {
        const k = s.floor, lvA = b.levels[k], lvB = b.levels[k + 1];
        if (!lvB) return;
        const xm = (s.x0 + s.x1) / 2;
        const dir = Math.sign(s.zb - s.za);
        rasterize(lvA, { x0: s.x0, x1: s.x1, z0: Math.min(s.za + dir * 0.6, s.zb), z1: Math.max(s.za + dir * 0.6, s.zb) }, 1, 0);
        const from = nodeAt(lvA, xm, s.za - dir * 0.7), to = nodeAt(lvB, xm, s.zb + dir * 0.75);
        if (from < 0 || to < 0) return;
        const lvf = levelOf(from), lvt = levelOf(to);
        lvf.cells[from - lvf.offset] = 0; lvt.cells[to - lvt.offset] = 0;
        const cost = Math.hypot(s.zb - s.za, 3.2) + 1.5;
        const add = (a, bb, up) => { let l = NAV.links.get(a); if (!l) { l = []; NAV.links.set(a, l); } l.push({ to: bb, cost, ramp: s, up }); };
        add(from, to, true); add(to, from, false);
      });
    });
  }
  function nodeAt(lv, x, z) {
    const i = Math.floor(x - lv.x0), j = Math.floor(z - lv.z0);
    if (i < 0 || j < 0 || i >= lv.nx || j >= lv.nz) return -1;
    return lv.offset + j * lv.nx + i;
  }
  function levelOf(node) {
    const ls = NAV.levels;
    for (let i = ls.length - 1; i >= 0; i--) if (node >= ls[i].offset) return ls[i];
    return ls[0];
  }
  function nodePos(node) {
    const lv = levelOf(node), id = node - lv.offset;
    return [lv.x0 + (id % lv.nx) + 0.5, lv.y, lv.z0 + Math.floor(id / lv.nx) + 0.5, lv];
  }
  // nível onde está um ponto
  function levelAt(x, y, z) {
    const b = buildingAt(x, z);
    if (b && b.levels) {
      const k = floorOf(b, y + 0.3);
      if (k >= 1 && b.levels[k]) return b.levels[k];
    }
    return ground;
  }
  function passable(node, canOpen) {
    const lv = levelOf(node), v = lv.cells[node - lv.offset];
    if (v === 0) return true;
    if (v === 2) { const d = doorCells.get(node); return d && (d.open || (canOpen && !d.locked)); }
    return false;
  }
  function nearestFree(lv, x, z, canOpen) {
    const n0 = nodeAt(lv, x, z);
    if (n0 >= 0 && passable(n0, canOpen)) return n0;
    for (let r = 1; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const n = nodeAt(lv, x + dx, z + dz);
        if (n >= 0 && passable(n, canOpen)) return n;
      }
    }
    return -1;
  }

  // A* sobre a grade multinível
  let gScore = null, came = null, stamp = null, closed = null, curStamp = 0;
  function findPath(sx, sy, sz, tx, ty, tz, canOpen, maxNodes) {
    if (!gScore) { gScore = new Float32Array(NAV.total); came = new Int32Array(NAV.total); stamp = new Uint32Array(NAV.total); closed = new Uint32Array(NAV.total); }
    curStamp++;
    const lvS = levelAt(sx, sy, sz), lvT = levelAt(tx, ty, tz);
    const s = nearestFree(lvS, sx, sz, canOpen), t = nearestFree(lvT, tx, tz, canOpen);
    if (s < 0 || t < 0) return null;
    const tp = nodePos(t);
    const hf = (n) => { const p = nodePos(n); return (Math.hypot(p[0] - tp[0], p[2] - tp[2]) + Math.abs(p[1] - tp[1]) * 2) * 1.001; };
    const heap = [];
    const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    stamp[s] = curStamp; gScore[s] = 0; came[s] = -1;
    push(s, hf(s));
    let expanded = 0, found = false;
    const limit = maxNodes || 12000;
    while (heap.length) {
      const [, n] = pop();
      if (closed[n] === curStamp) continue;
      closed[n] = curStamp;
      if (n === t) { found = true; break; }
      if (++expanded > limit) break;
      const g = gScore[n];
      const lv = levelOf(n), id = n - lv.offset, i = id % lv.nx, j = (id / lv.nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= lv.nx || nj >= lv.nz) continue;
        const nn = lv.offset + nj * lv.nx + ni;
        if (!passable(nn, canOpen)) continue;
        if (di && dj && (!passable(lv.offset + j * lv.nx + ni, canOpen) || !passable(lv.offset + nj * lv.nx + i, canOpen))) continue;
        const ng = g + (di && dj ? 1.414 : 1);
        if (stamp[nn] !== curStamp || ng < gScore[nn]) { stamp[nn] = curStamp; gScore[nn] = ng; came[nn] = n; push(nn, ng + hf(nn)); }
      }
      const links = NAV.links.get(n);
      if (links) for (const lk of links) {
        const ng = g + lk.cost;
        if (stamp[lk.to] !== curStamp || ng < gScore[lk.to]) { stamp[lk.to] = curStamp; gScore[lk.to] = ng; came[lk.to] = n; push(lk.to, ng + hf(lk.to)); }
      }
    }
    if (!found) return null;
    const nodes = [];
    for (let n = t; n !== -1; n = came[n]) nodes.push(n);
    nodes.reverse();
    // converte em pontos de passagem, simplificando trechos retos no mesmo nível
    const pts = [];
    let anchor = 0;
    pts.push(wp(nodes[0]));
    for (let k = 1; k < nodes.length; k++) {
      const a = nodes[anchor], cur = nodes[k], prev = nodes[k - 1];
      const la = levelOf(a), lc = levelOf(cur);
      if (la !== lc) { // troca de nível (rampa)
        if (prev !== a) pts.push(wp(prev));
        const p = wp(cur); p.link = true; pts.push(p);
        anchor = k; continue;
      }
      if (!lineFree(a, cur, canOpen)) { pts.push(wp(prev)); anchor = k - 1; }
    }
    const last = wp(nodes[nodes.length - 1]);
    if (pts[pts.length - 1].node !== last.node) pts.push(last);
    return pts;
  }
  function wp(n) { const p = nodePos(n); return { x: p[0], y: p[1], z: p[2], level: p[3].index, node: n }; }
  // trecho reto livre? amostra o segmento com folga lateral (evita cortar quinas e buracos)
  function lineFree(a, b, canOpen) {
    const lv = levelOf(a);
    const pa = nodePos(a), pb = nodePos(b);
    const dx = pb[0] - pa[0], dz = pb[2] - pa[2], len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    const px = -dz / len * 0.35, pz = dx / len * 0.35;
    const n = Math.ceil(len / 0.25);
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = pa[0] + dx * t, z = pa[2] + dz * t;
      for (const o of [0, 1, -1]) {
        const nn = nodeAt(lv, x + px * o, z + pz * o);
        if (nn < 0 || !passable(nn, canOpen)) return false;
      }
    }
    return true;
  }

  buildNav();

  /* --------------------------------------------------------------- utilidades */
  function doorToggle(d) { d.open = !d.open; return d.open; }
  function randomRoomPoint(b, rng, floor) {
    const rooms = b.rooms.filter((r) => (floor === undefined || r.floor === floor) && !r.locked);
    const r = rooms[Math.floor(rng() * rooms.length)];
    if (!r) return null;
    for (let tries = 0; tries < 12; tries++) {
      const x = M.lerp(r.x0 + 1, r.x1 - 1, rng()), z = M.lerp(r.z0 + 1, r.z1 - 1, rng());
      const lv = b.levels[r.floor] || ground;
      const n = nodeAt(lv, x, z);
      if (n >= 0 && passable(n, true)) return { x, y: r.y, z, floor: r.floor, room: r };
    }
    return null;
  }
  function randomStreetPoint(rng) {
    for (let t = 0; t < 30; t++) {
      const s = streets[Math.floor(rng() * streets.length)];
      const x = M.lerp(s.x0 + 2, s.x1 - 2, rng()), z = M.lerp(s.z0 + 2, s.z1 - 2, rng());
      const n = nodeAt(ground, x, z);
      if (n >= 0 && passable(n, false)) return { x, y: ELEV, z };
    }
    return { x: X0 + 200, y: ELEV, z: Z0 + 200 };
  }

  // estruturas construídas pelo jogador (barricadas, muros...) entram na colisão e na navegação
  function addDynamicWall(o) {
    addWall(o);
    rasterize(ground, o, 1, 0);
    return o;
  }

  FS.Town = {
    X0, Z0, SIZE, ELEV, H, STEP, center: { x: X0 + SIZE / 2, z: Z0 + SIZE / 2 },
    buildings, byId, walls, surfaces, doors, containers, windows, props, streets, lamps, camp, CONTAINER_KIND,
    groundAt, collideCircle, losClear, buildingAt, floorOf, inTown, surfaceTop,
    NAV, findPath, levelAt, nodeAt, passable, buildNav, doorToggle, randomRoomPoint, randomStreetPoint, rasterize, addDynamicWall,
  };
})(typeof window !== 'undefined' ? window : globalThis);
