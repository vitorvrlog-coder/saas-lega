/* terrain.js — dados do mundo (sem THREE): relevo, aeroportos, cidades e colisores.
 * Coordenadas: x = leste, y = altitude, z = sul. Rumo 0° = norte (-Z), horário.
 * A função heightAt() é determinística e infinita: o mapa não tem borda. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const DEG = M.DEG;

  const SURF = { GRASS: 0, ASPHALT: 1, WATER: 2, SAND: 3 };

  /* ---------------------------------------------------------------- Aeroportos */
  // Para criar novos aeroportos basta acrescentar uma entrada aqui.
  const AIRPORT_DEFS = [
    { id: 'LVV', name: 'Vale Verde Intl', x: 0, z: 0, heading: 90, elev: 45, length: 2600, width: 50 },
    { id: 'MAL', name: 'Monte Alto', x: 9800, z: -7200, heading: 35, elev: 150, length: 2100, width: 45 },
    { id: 'ILA', name: 'Ilha Azul', x: -10800, z: 7600, heading: 160, elev: 14, length: 2000, width: 45 },
  ];

  function makeAirport(d) {
    const h = d.heading * DEG;
    const ap = Object.assign({}, d);
    ap.fwd = [Math.sin(h), -Math.cos(h)];     // (x, z) ao longo da pista
    ap.right = [Math.cos(h), Math.sin(h)];    // (x, z) à direita da pista
    ap.runwayNumber = String(Math.round(d.heading / 10) % 36 || 36).padStart(2, '0');
    ap.reciprocalNumber = String(Math.round(((d.heading + 180) % 360) / 10) % 36 || 36).padStart(2, '0');
    ap.local = (x, z) => {
      const dx = x - ap.x, dz = z - ap.z;
      return [dx * ap.fwd[0] + dz * ap.fwd[1], dx * ap.right[0] + dz * ap.right[1]];
    };
    ap.world = (u, w) => [ap.x + ap.fwd[0] * u + ap.right[0] * w, ap.z + ap.fwd[1] * u + ap.right[1] * w];
    const L = d.length / 2;
    // Retângulos (u0,u1,w0,w1) no referencial da pista
    ap.runwayRect = [-L, L, -d.width / 2, d.width / 2];
    ap.taxiRects = [
      [-L + 80, L - 80, 119, 141],
      [-L + 109, -L + 131, d.width / 2, 130],
      [-11, 11, d.width / 2, 130],
      [L - 131, L - 109, d.width / 2, 130],
    ];
    ap.apronRect = [-380, 380, 141, 420];
    ap.flatRect = [-L - 250, L + 250, -150, 560];
    // posições iniciais
    ap.spawns = {
      runway: { u: -L + 120, w: 0, heading: d.heading },
      apron: { u: -90, w: 280, heading: d.heading },
    };
    // estruturas (caixas orientadas no referencial da pista): u, w, hu, hw, altura
    ap.structures = [
      { kind: 'hangar', u: -250, w: 480, hu: 38, hw: 32, h: 20 },
      { kind: 'hangar', u: -100, w: 480, hu: 38, hw: 32, h: 20 },
      { kind: 'hangar', u: 50, w: 480, hu: 38, hw: 32, h: 20 },
      { kind: 'terminal', u: 255, w: 455, hu: 70, hw: 26, h: 15 },
      { kind: 'tower', u: 130, w: 450, hu: 5, hw: 5, h: 38 },
    ];
    return ap;
  }
  const AIRPORTS = AIRPORT_DEFS.map(makeAirport);

  /* ------------------------------------------------------------------- Cidades */
  const CITY_DEFS = [
    { id: 'Porto Novo', x: -3600, z: -3300, r: 1000, seed: 3 },
    { id: 'Serra Alta', x: 12300, z: -3400, r: 800, seed: 7 },
    { id: 'Baía Azul', x: -13400, z: 4300, r: 800, seed: 11 },
  ];

  /* -------------------------------------------------------------------- Relevo */
  function natural(x, z) {
    const c = M.fbm(x / 12000 + 3.7, z / 12000 - 1.3, 4, 11);
    const hills = M.fbm(x / 1100, z / 1100, 4, 21);
    const mm = M.smoothstep(0.54, 0.70, M.fbm(x / 8000 - 9, z / 8000 + 4, 3, 31));
    let rid = 1 - Math.abs(2 * M.fbm(x / 3000 + 11, z / 3000 - 5, 4, 41) - 1);
    rid *= rid;
    let h = (c - 0.47) * 1100 + hills * 110 - 30 + mm * (rid * 1150 + 90);
    // rios: vales estreitos nas áreas baixas
    const rn = Math.abs(M.fbm(x / 3500 + 5, z / 3500 + 9, 3, 51) - 0.5);
    const river = (1 - M.smoothstep(0.0, 0.018, rn)) * M.smoothstep(240, 70, h);
    h = M.lerp(h, -7, river);
    return h;
  }

  const CITY_ELEV = CITY_DEFS.map((c) => Math.max(10, natural(c.x, c.z)));

  // áreas planas extras (vilas exploráveis) registradas por outros módulos
  const FLAT_ZONES = [];
  function addFlatZone(z) { FLAT_ZONES.push(z); }

  function rectDistance(u, w, r) {
    const du = Math.max(r[0] - u, 0, u - r[1]);
    const dw = Math.max(r[2] - w, 0, w - r[3]);
    return Math.hypot(du, dw);
  }
  const inRect = (u, w, r) => u >= r[0] && u <= r[1] && w >= r[2] && w <= r[3];

  function heightAt(x, z) {
    let h = natural(x, z);
    for (let i = 0; i < AIRPORTS.length; i++) {
      const ap = AIRPORTS[i];
      const dx = x - ap.x, dz = z - ap.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 10000 * 10000) continue;
      const k = M.smoothstep(2500, 9500, Math.sqrt(d2));
      h = ap.elev + (h - ap.elev) * (0.06 + 0.94 * k); // vale suave em volta do aeroporto
      if (d2 < 3200 * 3200) {
        const l = ap.local(x, z);
        const f = 1 - M.smoothstep(0, 900, rectDistance(l[0], l[1], ap.flatRect));
        if (f > 0) h = M.lerp(h, ap.elev, f);
      }
    }
    for (let i = 0; i < FLAT_ZONES.length; i++) {
      const fz = FLAT_ZONES[i];
      const du = Math.max(fz.x0 - x, 0, x - fz.x1), dw = Math.max(fz.z0 - z, 0, z - fz.z1);
      if (du > fz.blend || dw > fz.blend) continue;
      const f = 1 - M.smoothstep(0, fz.blend, Math.hypot(du, dw));
      if (f > 0) h = M.lerp(h, fz.elev, f);
    }
    for (let i = 0; i < CITY_DEFS.length; i++) {
      const c = CITY_DEFS[i];
      const dx = x - c.x, dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      const R = c.r + 700;
      if (d2 > R * R) continue;
      const f = 1 - M.smoothstep(0, 500, Math.max(0, Math.sqrt(d2) - c.r - 100));
      h = M.lerp(h, CITY_ELEV[i], f);
    }
    return h;
  }

  const groundHeight = (x, z) => Math.max(0, heightAt(x, z));

  function normalAt(x, z) {
    const e = 3;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    return [-dx / l, (2 * e) / l, -dz / l];
  }

  /* ------------------------------------------------------------------ Superfície */
  function airportAt(x, z, range) {
    for (let i = 0; i < AIRPORTS.length; i++) {
      const ap = AIRPORTS[i];
      const dx = x - ap.x, dz = z - ap.z;
      if (dx * dx + dz * dz < range * range) return ap;
    }
    return null;
  }

  function surfaceAt(x, z) {
    const ap = airportAt(x, z, 2200);
    if (ap) {
      const l = ap.local(x, z);
      if (inRect(l[0], l[1], ap.runwayRect) || inRect(l[0], l[1], ap.apronRect)) return SURF.ASPHALT;
      for (let i = 0; i < ap.taxiRects.length; i++) if (inRect(l[0], l[1], ap.taxiRects[i])) return SURF.ASPHALT;
    }
    const h = heightAt(x, z);
    if (h < 0) return SURF.WATER;
    if (h < 3.5) return SURF.SAND;
    return SURF.GRASS;
  }

  function nearestAirport(x, z) {
    let best = null, bd = Infinity;
    for (const ap of AIRPORTS) {
      const d = Math.hypot(ap.x - x, ap.z - z);
      if (d < bd) { bd = d; best = ap; }
    }
    return { airport: best, distance: bd };
  }

  // área onde não crescem árvores
  function isCleared(x, z) {
    for (const ap of AIRPORTS) {
      const dx = x - ap.x, dz = z - ap.z;
      if (dx * dx + dz * dz > 2600 * 2600) continue;
      const l = ap.local(x, z);
      if (rectDistance(l[0], l[1], ap.flatRect) < 120) return true;
    }
    for (const c of CITY_DEFS) if (Math.hypot(x - c.x, z - c.z) < c.r + 120) return true;
    for (const fz of FLAT_ZONES) if (x > fz.x0 - 40 && x < fz.x1 + 40 && z > fz.z0 - 40 && z < fz.z1 + 40) return true;
    return false;
  }

  /* --------------------------------------------------------------- Construções */
  // Caixa orientada: centro (cx,cz), eixo A (ax,az), eixo B perpendicular, meias-larguras hu/hw, y0..y1
  const buildings = [];   // cidades
  const cityBuildings = CITY_DEFS.map(() => []);
  const colliders = [];
  const CELL = 400;
  const grid = new Map();

  function addCollider(box) {
    colliders.push(box);
    const r = Math.hypot(box.hu, box.hw);
    const i0 = Math.floor((box.cx - r) / CELL), i1 = Math.floor((box.cx + r) / CELL);
    const j0 = Math.floor((box.cz - r) / CELL), j1 = Math.floor((box.cz + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = i + ',' + j;
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        cell.push(box);
      }
    }
  }

  // estruturas dos aeroportos
  const airportStructures = [];
  AIRPORTS.forEach((ap) => {
    ap.structures.forEach((s) => {
      const c = ap.world(s.u, s.w);
      const box = { cx: c[0], cz: c[1], ax: ap.fwd[0], az: ap.fwd[1], bx: ap.right[0], bz: ap.right[1],
        hu: s.hu, hw: s.hw, y0: ap.elev, y1: ap.elev + s.h, kind: s.kind, airport: ap.id };
      addCollider(box);
      airportStructures.push(box);
    });
  });

  // cidades
  CITY_DEFS.forEach((city, ci) => {
    const rng = M.mulberry32(city.seed * 7919);
    const elev = CITY_ELEV[ci];
    const step = 110;
    const n = Math.ceil(city.r / step);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const bx = city.x + i * step, bz = city.z + j * step;
        const d = Math.hypot(bx - city.x, bz - city.z);
        if (d > city.r) continue;
        const dn = d / city.r;
        for (let k = 0; k < 4; k++) {
          if (rng() > 0.95 - 0.55 * dn) continue;
          const ox = (k % 2 ? 1 : -1) * 27, oz = (k < 2 ? 1 : -1) * 27;
          const hu = 11 + rng() * 9, hw = 11 + rng() * 9;
          const core = Math.pow(1 - dn, 1.6);
          let h = 8 + rng() * 14 + core * rng() * 130;
          if (dn < 0.12 && k === 0) h += 60 + rng() * 60; // arranha-céus no centro
          const box = { cx: bx + ox, cz: bz + oz, ax: 1, az: 0, bx: 0, bz: 1, hu, hw, y0: elev, y1: elev + h, kind: 'city', city: ci };
          addCollider(box);
          cityBuildings[ci].push(box);
          buildings.push(box);
        }
      }
    }
  });

  const hasColliders = (x, z) => grid.has(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));

  // ponto (x,y,z) dentro de alguma construção?
  function hitsBuilding(x, y, z) {
    const cell = grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (!cell) return null;
    for (let i = 0; i < cell.length; i++) {
      const b = cell[i];
      if (y < b.y0 || y > b.y1) continue;
      const dx = x - b.cx, dz = z - b.cz;
      if (Math.abs(dx * b.ax + dz * b.az) <= b.hu && Math.abs(dx * b.bx + dz * b.bz) <= b.hw) return b;
    }
    return null;
  }

  /* ------------------------------------------------------------- Estradas (rotas) */
  // pontos [x,z]; construídas como fitas sobre o relevo em world.js
  const ROADS = [];
  function straightRoad(from, to, width) {
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = Math.max(2, Math.round(dist / 70));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // leve curva senoidal para parecer mais natural
      const wob = Math.sin(t * Math.PI * 3) * 60 * Math.sin(t * Math.PI);
      const dx = to[0] - from[0], dz = to[1] - from[1], l = Math.hypot(dx, dz);
      pts.push([from[0] + dx * t - (dz / l) * wob, from[1] + dz * t + (dx / l) * wob]);
    }
    ROADS.push({ points: pts, width });
  }
  (function () {
    const lvv = AIRPORTS[0];
    const hangarRoad = lvv.world(-420, 470);
    straightRoad([hangarRoad[0], hangarRoad[1]], [CITY_DEFS[0].x + 700, CITY_DEFS[0].z + 500], 14);
    straightRoad([CITY_DEFS[0].x + 800, CITY_DEFS[0].z + 100], [CITY_DEFS[1].x - 800, CITY_DEFS[1].z + 200], 12);
    const mal = AIRPORTS[1];
    const p = mal.world(-420, 470);
    straightRoad([p[0], p[1]], [CITY_DEFS[1].x + 300, CITY_DEFS[1].z - 700], 12);
    const ila = AIRPORTS[2];
    const q = ila.world(-420, 470);
    straightRoad([q[0], q[1]], [CITY_DEFS[2].x + 800, CITY_DEFS[2].z + 100], 12);
  })();

  FS.Terrain = {
    SURF, AIRPORTS, CITY_DEFS, CITY_ELEV, ROADS,
    heightAt, groundHeight, normalAt, surfaceAt, nearestAirport, airportAt, isCleared,
    hitsBuilding, hasColliders, addFlatZone, FLAT_ZONES, straightRoad, buildings, cityBuildings, airportStructures, colliders,
    natural,
    forestDensity: (x, z) => M.fbm(x / 520 + 31, z / 520 - 17, 3, 71),
  };
})(typeof window !== 'undefined' ? window : globalThis);
