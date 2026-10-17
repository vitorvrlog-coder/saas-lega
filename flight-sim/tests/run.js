#!/usr/bin/env node
/* Testes da lógica pura (sem navegador): física de voo, cidade/navegação e simulação do mundo.
 * Uso: node tests/run.js */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = undefined;
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f + '.js'), 'utf8');
for (const f of ['util', 'terrain', 'flightPhysics', 'town', 'items', 'sim', 'dialogue']) eval(src(f)); // eslint-disable-line no-eval
const { M, Terrain: T, Town: TW, Sim: S, Items: IT, Dialogue: D } = globalThis.FS;

let fails = 0;
const check = (name, ok, info) => { console.log((ok ? '  ok   ' : '  FALHA ') + name + (info ? '  (' + info + ')' : '')); if (!ok) fails++; };
const dt = 1 / 240, DEG = M.DEG;

console.log('Física de voo');
{
  const ap = T.AIRPORTS[0], sp = ap.spawns.runway, w = ap.world(sp.u, sp.w);
  const m = new FS.FlightModel(); m.reset({ x: w[0], z: w[1] }, sp.heading);
  check('avião parado e apoiado no trem', Math.abs(m.v[1]) < 0.01 && m.onGround);
  m.toggleEngine(); for (let i = 0; i < 240 * 7; i++) m.step(dt);
  check('motores ligam', m.enginePhase === 'running');
  m.input.throttle = 1; m.input.flapsIdx = 1;
  let lift = null;
  for (let i = 0; i < 240 * 60 && !lift; i++) { m.input.stickY = m.ias * 3.6 > 290 ? (m.pitch < 12 * DEG ? 0.6 : 0) : 0; m.step(dt); if (!m.onGround) lift = m.ias * 3.6; }
  check('decola pela sustentação', lift && lift > 250 && lift < 450, lift && lift.toFixed(0) + ' km/h');
  const f = new FS.FlightModel(); f.reset({ x: -30000, z: 30000 }, 90);
  f.p = [-30000, 3000, 30000]; f.v = M.qRot(f.q, [0, 0, -140]); f.onGround = false; f.airTime = 5; f.enginePhase = 'running'; f.rpm = 0.6; f.gearPos = 0; f.input.gearCmd = 0;
  f.input.stickX = 0.5; for (let i = 0; i < 240; i++) f.step(dt);
  check('manche à direita inclina à direita', f.bank > 0.3, (f.bank / DEG).toFixed(0) + '°');
}

console.log('Cidade e navegação');
{
  check('prédios exploráveis', TW.buildings.length >= 10, TW.buildings.length + ' prédios');
  check('móveis com saque', TW.containers.length > 60, TW.containers.length);
  TW.doors.forEach((d) => { if (d.main) d.open = true; });
  const st = TW.randomStreetPoint(M.mulberry32(1));
  let ok = 0, total = 0;
  for (const b of TW.buildings) for (let k = 0; k < b.floors; k++) {
    const r = TW.randomRoomPoint(b, M.mulberry32(k + 3), k); if (!r) continue;
    total++; if (TW.findPath(st.x, st.y, st.z, r.x, r.y, r.z, true, 80000)) ok++;
  }
  check('caminho da rua até todos os andares', ok === total, ok + '/' + total);
  const ap = TW.byId.aurora;
  const p = TW.findPath(ap.entrance.x, TW.ELEV, ap.entrance.z, (ap.x0 + ap.x1) / 2, ap.floorY(4), ap.z0 + 3, true, 60000);
  let x = ap.entrance.x, z = ap.entrance.z, y = TW.ELEV;
  for (const w of p || []) for (let it = 0; it < 3000; it++) {
    const dx = w.x - x, dz = w.z - z, dd = Math.hypot(dx, dz);
    if (dd < 0.3 && Math.abs(y - w.y) < 1) break;
    const s = Math.min(0.1, dd);
    let nx = dd > 1e-6 ? x + dx / dd * s : x, nz = dd > 1e-6 ? z + dz / dd * s : z;
    [nx, nz] = TW.collideCircle(nx, nz, y, 0.3, 1.7);
    const g = TW.groundAt(nx, nz, y); y = g > y - 0.6 ? g : y - 0.2; x = nx; z = nz;
  }
  check('caminhada com colisão sobe 4 andares até o telhado', Math.abs(y - ap.floorY(4)) < 0.1, 'y ' + y.toFixed(2));
  const h = TW.byId.hosp;
  check('paredes bloqueiam a linha de visada', !TW.losClear(h.x0 - 5, 46, h.z0 + 5, h.x0 + 5, 46.5, h.z0 + 5));
}

console.log('Simulação do mundo');
{
  const c = TW.byId.casaC.inside;
  const P = { x: c.x, y: TW.ELEV, z: c.z, kills: 0 };
  let dmg = 0;
  S.init(P, { onPlayerHit: (d) => { dmg += d; } });
  check('sobreviventes criados (homens e mulheres)', Object.values(S.npcs).filter((n) => n.g === 'f').length >= 5 && Object.values(S.npcs).filter((n) => n.g === 'm').length >= 5);
  check('quatro facções', Object.keys(S.factions).length === 4);
  S.dayLength = 120;
  for (let i = 0; i < 60 * 240; i++) S.update(1 / 60);
  check('dias passam e eventos acontecem', S.day() >= 3 && S.log.length > 3, S.clock() + ', ' + S.log.length + ' registros');
  const data = JSON.parse(JSON.stringify(S.serialize()));
  S.load(data);
  check('salvamento e carregamento', S.t === data.t);
  // diálogo, missão e recrutamento
  const n = S.npcs.carlos;
  const inv = new IT.Inventory(25);
  const pl = { inv, hp: 100, x: n.x, y: n.y, z: n.z };
  let node = D.greet(S, n, pl);
  check('diálogo inicial', node.options.length > 3);
  node = D.choose(S, n, pl, 'quest');
  const q = node.options[0].arg; D.choose(S, n, pl, 'accept', q);
  inv.add('antibiotico', 1);
  check('missão pronta para entrega', S.questReady(q, inv));
  D.choose(S, n, pl, 'questDone', q);
  check('confiança aumenta ao cumprir a missão', n.trust >= 45, 'confiança ' + n.trust);
  D.choose(S, n, pl, 'recruit');
  check('recrutamento após ganhar confiança', n.companion === true);
}

console.log(fails ? `\n${fails} falha(s).` : '\nTodos os testes passaram.');
process.exit(fails ? 1 : 0);
