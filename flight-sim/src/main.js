/* main.js — cena, câmeras, laço principal (passo fixo + interpolação), estados e menus. */
(function () {
  'use strict';
  const FS = window.FS;
  const M = FS.M;
  const T = FS.Terrain;
  const S = FS.Settings.data;
  const DEG = M.DEG;
  const $ = (id) => document.getElementById(id);

  const FIXED_DT = 1 / 240;

  /* ------------------------------------------------------------------ renderizador */
  const canvas = $('gl');
  let renderer;
  const mobile = window.matchMedia('(pointer: coarse)').matches;
  try {
    // profundidade logarítmica evita "z-fighting" das marcações da pista; em celulares usamos profundidade comum + polygonOffset
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance', logarithmicDepthBuffer: !mobile });
  } catch (e) {
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: false }); }
    catch (e2) { document.body.classList.add('no-webgl'); $('nowebgl').hidden = false; return; }
  }
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(S.fov, 1, mobile ? 0.45 : 0.25, 42000);
  scene.add(camera);

  const world = new FS.World(scene, renderer);
  const aircraft = new FS.Aircraft();
  scene.add(aircraft.root);
  const cockpit = new FS.CockpitRig();
  camera.add(cockpit.group);
  const model = new FS.FlightModel();
  const hud = new FS.Hud($('hud'));
  const controls = new FS.Controls(canvas, {
    onAction: (a) => doAction(a),
    onEscape: () => { if (game.state === 'flying') openPause(); else if (game.state === 'paused' && $('scr-pause').classList.contains('show')) resumeFlight(); },
    onUnlock: () => { if (game.state === 'flying') openPause(); },
    onBrakeTap: () => model.releaseParkBrake(),
  });
  FS.isTouch = false;

  /* -------------------------------------------------------------------- estado geral */
  const game = {
    state: 'menu',          // menu | loading | flying | paused | crashed
    time: 0,
    acc: 0,
    destIndex: 0,
    airport: T.AIRPORTS[0],
    camMode: 'chase',       // cockpit | third | chase | free
    lastExternal: 'chase',
    hasFlown: false,
    maxDt: 0.1, maxSteps: 40,
  };
  const CAM_ORDER = ['third', 'chase', 'free'];
  const camState = {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), from: null, blend: 1,
    smooth: new THREE.Quaternion(), dirSmooth: new THREE.Vector3(0, 0, -1),
    freeYaw: 0.4, freeDist: 30, freePitch: 0.25, shake: 0,
    hasInit: false,
  };
  const msgs = { last: '' };

  /* -------------------------------------------------------------------- qualidade */
  function applyQuality() {
    const q = FS.Settings.quality();
    world.setQuality(q);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    resize();
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = S.fov;
    camera.updateProjectionMatrix();
    hud.resize();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  /* -------------------------------------------------------------------- voos */
  const dstate = (name) => game.state === name;
  function spawn() {
    const ap = T.AIRPORTS.find((a) => a.id === S.startAirport) || T.AIRPORTS[0];
    game.airport = ap;
    const sp = ap.spawns[S.startPos] || ap.spawns.runway;
    const w = ap.world(sp.u, sp.w);
    model.events = {
      gear: () => FS.Audio.gear(),
      flaps: () => FS.Audio.flaps(),
      touch: (sink) => FS.Audio.touch(sink),
      crash: () => { FS.Audio.crash(); },
    };
    model.reset({ x: w[0], z: w[1] }, sp.heading);
    controls.resetControls();
    controls.throttle = 0;
    // destino padrão: outro aeroporto
    game.destIndex = (T.AIRPORTS.indexOf(ap) + 1) % T.AIRPORTS.length;
    crashShown = false; landingShown = null; lastOnGround = true; takeoffAnnounced = false; fpsAcc = 0;
    $('landing').classList.remove('show'); $('crash').classList.remove('show');
    camState.hasInit = false;
    aircraft.root.visible = true;
  }

  async function startFlight() {
    FS.Audio.unlock();
    FS.Audio.click();
    game.state = 'loading';
    showScreen(null);
    $('loading').classList.add('show');
    applyQuality();
    world.setPreset(S.time);
    spawn();
    syncRender(1);
    const ap = game.airport;
    await world.preload(ap.x, ap.z, (p) => { $('load-bar').style.width = Math.round(p * 100) + '%'; });
    $('loading').classList.remove('show');
    game.state = 'flying';
    game.hasFlown = true;
    setCamMode(S.startPos === 'runway' ? 'chase' : 'chase', true);
    controls.active = true;
    game.acc = 0;
    lastTime = performance.now();
    showScreen(null);
    FS.Audio.setPaused(false);
    $('overlay-hud').classList.add('on');
    const touch = document.body.classList.contains('touch');
    hud.notify(touch ? 'Toque em MOTOR para ligar os motores' : 'Pressione R para ligar os motores', '#6dffa8', 6);
    hud.notify(game.airport.name + ' — pista ' + game.airport.runwayNumber + (touch ? '' : ' · clique para capturar o mouse'), '#9fe9bd', 6);
    canvas.focus();
  }

  function restartFlight() {
    FS.Audio.unlock();
    game.state = 'flying';
    spawn();
    syncRender(1);
    controls.active = true;
    game.acc = 0;
    showScreen(null);
    FS.Audio.setPaused(false);
    $('overlay-hud').classList.add('on');
    hud.notify('Voo reiniciado em ' + game.airport.name, '#6dffa8', 4);
  }

  function backToMenu() {
    game.state = 'menu';
    controls.active = false;
    controls.exitLock();
    $('overlay-hud').classList.remove('on');
    $('landing').classList.remove('show');
    $('crash').classList.remove('show');
    FS.Audio.setPaused(true);
    $('btn-resume').hidden = true;
    showScreen('main');
    spawn();
    syncRender(1);
  }

  /* ------------------------------------------------------------------ pausa / menu */
  function openPause() {
    if (game.state !== 'flying' && game.state !== 'crashed') return;
    if (game.state === 'flying') game.state = 'paused';
    controls.active = false;
    controls.releaseAll();
    controls.exitLock();
    FS.Audio.setPaused(true);
    $('pause-title').textContent = model.crashed ? 'AERONAVE DESTRUÍDA' : 'PAUSADO';
    $('btn-resume').hidden = !!model.crashed;
    showScreen('pause');
  }
  function resumeFlight() {
    if (game.state !== 'paused') return;
    game.state = 'flying';
    controls.active = true;
    lastTime = performance.now();
    game.acc = 0;
    FS.Audio.unlock();
    FS.Audio.setPaused(false);
    showScreen(null);
    canvas.focus();
  }
  function togglePause() {
    if (game.state === 'flying') openPause();
    else if (game.state === 'paused') resumeFlight();
  }

  /* ------------------------------------------------------------------------- ações */
  function doAction(a) {
    FS.Audio.unlock();
    if (game.state === 'menu' || game.state === 'loading') return;
    if (a === 'pause') { togglePause(); return; }
    if (game.state !== 'flying') return;
    switch (a) {
      case 'gear': model.toggleGear(); break;
      case 'flaps': model.cycleFlaps(); break;
      case 'engine': model.toggleEngine(); if (model.enginePhase === 'starting') FS.Audio.engineStart(); break;
      case 'camera': cycleCamera(); break;
      case 'view': setCamMode(game.camMode === 'cockpit' ? game.lastExternal : 'cockpit'); break;
      case 'destination': game.destIndex = (game.destIndex + 1) % T.AIRPORTS.length; hud.notify('Destino: ' + T.AIRPORTS[game.destIndex].name, '#5fe0ff', 3); break;
      case 'hud': hud.visible = !hud.visible; break;
      default:
    }
  }

  function setCamMode(mode, instant) {
    if (mode !== 'cockpit') game.lastExternal = mode;
    game.camMode = mode;
    controls.freeLook = mode === 'free';
    if (!instant && camState.hasInit) { camState.from = { pos: camera.position.clone(), quat: camera.quaternion.clone() }; camState.blend = 0; }
    const names = { cockpit: 'COCKPIT', third: 'TERCEIRA PESSOA', chase: 'PERSEGUIÇÃO DINÂMICA', free: 'CÂMERA LIVRE' };
    if (game.state === 'flying') hud.notify('Câmera: ' + names[mode], '#9fe9bd', 1.8);
  }
  function cycleCamera() {
    const i = CAM_ORDER.indexOf(game.camMode);
    setCamMode(CAM_ORDER[(i + 1) % CAM_ORDER.length]);
  }

  /* ------------------------------------------------------------------------ câmeras */
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
  let renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion();

  function syncRender(alpha) {
    const p = model.p, pp = model.prevP;
    renderPos.set(M.lerp(pp[0], p[0], alpha), M.lerp(pp[1], p[1], alpha), M.lerp(pp[2], p[2], alpha));
    const q = M.qSlerp(model.prevQ, model.q, alpha);
    renderQuat.set(q[0], q[1], q[2], q[3]);
    aircraft.root.position.copy(renderPos);
    aircraft.root.quaternion.copy(renderQuat);
  }

  function updateCamera(dt) {
    const mode = game.camMode;
    const targetPos = tmpV2, targetQuat = tmpQ2;
    if (!camState.hasInit) {
      camState.smooth.copy(renderQuat);
      camState.dirSmooth.set(model.fwd[0], 0, model.fwd[2]).normalize();
      camState.hasInit = true;
    }
    const fwd = tmpV.set(model.fwd[0], model.fwd[1], model.fwd[2]);

    if (mode === 'cockpit') {
      // olho do piloto, ligeiramente à frente do CG; vibração em estol
      const shake = camState.shake;
      targetPos.set(0, 0.62, -3.55);
      targetPos.applyQuaternion(renderQuat).add(renderPos);
      if (shake > 0.01) targetPos.add(tmpV.set((Math.random() - 0.5) * 0.05 * shake, (Math.random() - 0.5) * 0.05 * shake, 0).applyQuaternion(renderQuat));
      targetQuat.copy(renderQuat);
    } else if (mode === 'third') {
      const k = 1 - Math.exp(-dt * 6);
      tmpV.set(model.fwd[0], model.fwd[1] * 0.5, model.fwd[2]).normalize();
      camState.dirSmooth.lerp(tmpV, k).normalize();
      targetPos.copy(renderPos).addScaledVector(camState.dirSmooth, -24).add(tmpV.set(0, 6.5, 0));
      targetQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(targetPos, tmpV.copy(renderPos).addScaledVector(camState.dirSmooth, 12), new THREE.Vector3(0, 1, 0)));
    } else if (mode === 'chase') {
      const k = 1 - Math.exp(-dt * 3.2);
      camState.smooth.slerp(renderQuat, k);
      targetPos.set(0, 3.4, 20).applyQuaternion(camState.smooth).add(renderPos);
      tmpQ.setFromAxisAngle(tmpV.set(1, 0, 0), -0.1);
      targetQuat.copy(camState.smooth).multiply(tmpQ);
    } else { // livre
      const cm = controls.cameraMouse;
      camState.freeYaw -= cm.dx * 0.005; camState.freePitch = M.clamp(camState.freePitch + cm.dy * 0.005, -1.4, 1.4);
      camState.freeDist = M.clamp(camState.freeDist * (1 + cm.wheel * 0.0012), 10, 160);
      cm.dx = cm.dy = cm.wheel = 0;
      const cp = Math.cos(camState.freePitch), sp = Math.sin(camState.freePitch);
      targetPos.set(Math.sin(camState.freeYaw) * cp, sp, Math.cos(camState.freeYaw) * cp).multiplyScalar(camState.freeDist).add(renderPos);
      targetQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(targetPos, renderPos, new THREE.Vector3(0, 1, 0)));
    }
    // câmeras externas não atravessam o solo
    if (mode !== 'cockpit') {
      const gh = T.groundHeight(targetPos.x, targetPos.z) + 3;
      if (targetPos.y < gh) targetPos.y = gh;
    }
    // transição suave entre câmeras
    if (camState.blend < 1 && camState.from) {
      camState.blend = Math.min(1, camState.blend + dt / 0.7);
      const t = camState.blend * camState.blend * (3 - 2 * camState.blend);
      camera.position.lerpVectors(camState.from.pos, targetPos, t);
      camera.quaternion.slerpQuaternions(camState.from.quat, targetQuat, t);
    } else {
      camera.position.copy(targetPos);
      camera.quaternion.copy(targetQuat);
    }
    const inCockpit = mode === 'cockpit' && camState.blend >= 0.5;
    aircraft.model.visible = !(mode === 'cockpit' && camState.blend >= 1);
    cockpit.group.visible = inCockpit;
    // a câmera também influencia a aeronave: fica oculta apenas no cockpit
    camera.updateMatrixWorld(true);
  }

  /* ---------------------------------------------------------------------- projetor do HUD */
  const projVec = new THREE.Vector3();
  function projector(dir, out) {
    projVec.set(camera.position.x + dir[0] * 3000, camera.position.y + dir[1] * 3000, camera.position.z + dir[2] * 3000);
    projVec.project(camera);
    if (projVec.z > 1 || projVec.z < -1) return false;
    out[0] = (projVec.x * 0.5 + 0.5) * hud.W;
    out[1] = (-projVec.y * 0.5 + 0.5) * hud.H;
    return true;
  }

  /* ----------------------------------------------------------------- eventos de voo */
  let crashShown = false, landingShown = null, lastOnGround = true, takeoffAnnounced = false;
  function handleModelEvents() {
    while (model.msgs.length) {
      const t = model.msgs.shift();
      const bad = /DANIFIC|ARRANCAD|SUPERAQ|NÃO É POSS|SÓ PODEM|EXIGE/.test(t);
      hud.notify(t, bad ? '#ffc83a' : '#6dffa8', 3);
    }
    if (model.takeoffEvent) {
      model.takeoffEvent = false;
      if (!takeoffAnnounced) { takeoffAnnounced = true; hud.notify('DECOLAGEM!  Recolha o trem de pouso (F)', '#6dffa8', 4); }
    }
    if (model.touchdown && landingShown !== model.touchdown && !model.crashed) {
      landingShown = model.touchdown;
      showLanding(model.touchdown);
    }
    if (model.crashed && !crashShown) {
      crashShown = true;
      aircraft.root.visible = false;
      showCrash();
    }
    if (model.touchdown && model.touchdown.stopped && !model.crashed) updateLanding(model.touchdown, true);
    else if (model.touchdown && landingShown === model.touchdown) updateLanding(model.touchdown, false);
  }

  function ratingColor(level) { return ['#6dffa8', '#9fe9bd', '#ffc83a', '#ff4a3d'][level]; }
  function showLanding(td) {
    const el = $('landing');
    updateLanding(td, false);
    el.classList.add('show');
    clearTimeout(showLanding.timer);
    showLanding.timer = setTimeout(() => { if (game.state === 'flying') el.classList.remove('show'); }, 14000);
  }
  function updateLanding(td, stopped) {
    $('landing-rating').textContent = td.rating;
    $('landing-rating').style.color = ratingColor(td.level);
    const rows = [
      ['Razão de descida', td.sink.toFixed(1) + ' m/s'],
      ['Velocidade de toque', Math.round(td.speedKmh) + ' km/h'],
      ['Inclinação lateral', td.bank.toFixed(0) + '°'],
      ['Alinhamento com a pista', td.onRunway ? td.headingError.toFixed(0) + '° / ' + Math.abs(td.offset).toFixed(0) + ' m do eixo' : 'fora da pista'],
      ['Ponto de toque', td.onRunway ? Math.round(td.along) + ' m da cabeceira' : '—'],
      ['Distância de frenagem', Math.round(td.rollout) + ' m' + (stopped ? ' (parado)' : '')],
    ];
    $('landing-rows').innerHTML = rows.map((r) => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
    $('landing-notes').textContent = td.reasons.length ? td.reasons.join(' · ') : 'Sem observações: toque limpo.';
  }
  function showCrash() {
    $('crash-reason').textContent = model.crashReason;
    const td = model.touchdown;
    $('crash-detail').textContent = td ? 'Velocidade ' + Math.round(model.crashSpeed * 3.6) + ' km/h · razão de descida ' + Math.max(0, td.sink).toFixed(1) + ' m/s' : '';
    $('crash').classList.add('show');
    game.state = 'crashed';
    controls.active = false;
    controls.releaseAll();
    controls.exitLock();
    $('landing').classList.remove('show');
  }

  /* ----------------------------------------------------------------- laço principal */
  let lastTime = performance.now();
  let fpsAcc = 0, frames = 0, fps = 60, hudTimer = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - lastTime) / 1000;
    let dt = Math.min(game.maxDt, rawDt);
    lastTime = now;
    frames++; fpsAcc += rawDt;
    if (fpsAcc > 0.5) { fps = frames / fpsAcc; frames = 0; fpsAcc = 0; }

    const flying = game.state === 'flying';
    if (flying) {
      // entradas
      controls.update(dt);
      const inp = model.input;
      inp.stickX = controls.out.x; inp.stickY = controls.out.y;
      inp.rudder = controls.rudder; inp.throttle = controls.throttle; inp.trim = controls.trim; inp.brake = controls.brake;
      // passos fixos
      game.acc += dt;
      let steps = 0;
      while (game.acc >= FIXED_DT && steps < game.maxSteps) { model.step(FIXED_DT); game.acc -= FIXED_DT; steps++; }
      if (steps >= game.maxSteps) game.acc = 0;
      game.time += dt;
      handleModelEvents();
    } else if (game.state === 'crashed') {
      game.time += dt;
    }

    // interpolação visual entre passos
    const alpha = flying ? game.acc / FIXED_DT : 1;
    syncRender(M.clamp(alpha, 0, 1));
    camState.shake = M.clamp(Math.max(model.stallWarn * (1 - model.onGround), 0) * 1.2 + Math.max(0, model.qbar / 40000 - 0.6) * 0.5, 0, 1.5) * (flying ? 1 : 0);
    const camDt = game.state === 'paused' ? 0 : dt;
    updateCamera(camDt);
    aircraft.update(model, game.time);
    const dtWorld = game.state === 'paused' ? 0 : dt;
    world.update(model.p, camera.position, dtWorld, renderPos);
    cockpit.update(model, S.units, game.time, camera.aspect);

    // HUD
    const nav = FS.navInfo(model, T.AIRPORTS[game.destIndex]);
    FS.Instruments.dest = nav;
    const info = { dt: game.state === 'paused' ? 0 : dt, time: game.time, units: S.units, nav, projector, touch: document.body.classList.contains('touch'), widgetH: ($('stick').offsetHeight || 150) + 30 };
    if (flying || game.state === 'crashed' || game.state === 'paused') {
      // aviso de terreno e de trem
      const aheadX = model.p[0] + model.v[0] * 6, aheadZ = model.p[2] + model.v[2] * 6;
      const aheadH = T.groundHeight(aheadX, aheadZ);
      info.terrainWarn = !model.onGround && model.agl < 600 && model.vs < -4 && (model.p[1] + model.vs * 6 < aheadH + 30) && model.V > 60;
      info.gearWarn = !model.onGround && model.gearPos < 0.9 && model.agl < 280 && model.V < 130 && model.vs < 0 && model.enginePhase === 'running';
      hud.draw(model, info);
      drawWidgets();
      FS.Audio.update(model, game.state === 'paused' ? 0 : dt, model.stallWarn, {
        terrain: info.terrainWarn, gearWarn: info.gearWarn, overspeed: model.overSpeed, overG: model.overG, overheat: model.overheated,
      });
    } else {
      hud.clear();
    }
    renderer.render(scene, camera);
  }

  /* ----------------------------------------------------- manche e manete na tela */
  const stickKnob = $('stick-knob'), throttleFill = $('thr-fill'), throttleHandle = $('thr-handle'), throttleVal = $('thr-val');
  function drawWidgets() {
    const raw = controls.rawStick || { x: 0, y: 0 };
    const R = $('stick').clientWidth * 0.4;
    stickKnob.style.transform = `translate(${M.clamp(raw.x, -1, 1) * R}px, ${M.clamp(raw.y, -1, 1) * R}px)`;
    const th = controls.throttle;
    throttleFill.style.height = Math.round(th * 100) + '%';
    throttleHandle.style.bottom = `calc(${th * 100}% - 7px)`;
    throttleVal.textContent = Math.round(th * 100) + '%';
    throttleVal.className = model.rpm > 0.9 ? 'ab' : '';
    $('thr-rpm').style.height = Math.round(model.rpm * 100) + '%';
    $('thr-tag').textContent = th > 0.995 ? 'MÁX' : th < 0.005 ? 'MÍN' : model.overheated ? 'SUPERAQ.' : th > 0.85 ? 'PÓS-COMB.' : '';
  }

  /* -------------------------------------------------------------------- UI / menus */
  const screens = ['main', 'aircraft', 'controls', 'settings', 'pause', 'briefing'];
  const stack = [];
  function showScreen(name) {
    screens.forEach((s) => { const el = $('scr-' + s); if (el) el.classList.toggle('show', s === name); });
    $('menu-layer').classList.toggle('show', !!name);
    if (name) {
      const el = $('scr-' + name);
      const first = el.querySelector('.btn.primary') || el.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
  }
  function openSub(name) { stack.push(game.state === 'paused' ? 'pause' : 'main'); showScreen(name); if (name === 'controls') buildControlsScreen(); }
  function closeSub() { showScreen(stack.pop() || 'main'); }

  $('btn-start').addEventListener('click', () => { FS.Audio.unlock(); FS.Audio.click(); stack.length = 0; fillBriefing(); showScreen('briefing'); });
  $('btn-aircraft').addEventListener('click', () => { FS.Audio.unlock(); FS.Audio.click(); openSub('aircraft'); });
  $('btn-controls').addEventListener('click', () => { FS.Audio.unlock(); FS.Audio.click(); openSub('controls'); });
  $('btn-settings').addEventListener('click', () => { FS.Audio.unlock(); FS.Audio.click(); openSub('settings'); });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { FS.Audio.click(); closeSub(); }));
  $('btn-briefing-back').addEventListener('click', () => { FS.Audio.click(); showScreen('main'); });
  $('btn-fly').addEventListener('click', () => { startFlight(); });
  $('btn-resume').addEventListener('click', () => resumeFlight());
  $('btn-restart').addEventListener('click', () => { FS.Audio.click(); restartFlight(); });
  $('btn-pause-controls').addEventListener('click', () => { FS.Audio.click(); openSub('controls'); });
  $('btn-pause-settings').addEventListener('click', () => { FS.Audio.click(); openSub('settings'); });
  $('btn-menu').addEventListener('click', () => { FS.Audio.click(); backToMenu(); });
  $('crash-restart').addEventListener('click', () => { restartFlight(); });
  $('crash-menu').addEventListener('click', () => { backToMenu(); });
  $('landing-close').addEventListener('click', () => $('landing').classList.remove('show'));
  $('btn-mobile-pause').addEventListener('click', () => togglePause());

  // briefing (aeroporto, posição, horário)
  function fillBriefing() {
    const sel = $('sel-airport');
    if (!sel.options.length) T.AIRPORTS.forEach((ap) => { const o = document.createElement('option'); o.value = ap.id; o.textContent = `${ap.id} — ${ap.name} (pista ${ap.runwayNumber}/${ap.reciprocalNumber}, ${ap.length} m)`; sel.appendChild(o); });
    sel.value = S.startAirport; $('sel-pos').value = S.startPos; $('sel-time').value = S.time;
  }
  $('sel-airport').addEventListener('change', (e) => { S.startAirport = e.target.value; FS.Settings.save(); });
  $('sel-pos').addEventListener('change', (e) => { S.startPos = e.target.value; FS.Settings.save(); });
  $('sel-time').addEventListener('change', (e) => { S.time = e.target.value; FS.Settings.save(); world.setPreset(S.time); });

  // configurações
  const bindRange = (id, key, fmt, cb) => {
    const el = $(id), out = $(id + '-v');
    el.value = S[key];
    const upd = () => { out.textContent = fmt(+el.value); };
    el.addEventListener('input', () => { S[key] = +el.value; upd(); FS.Settings.save(); if (cb) cb(); });
    upd();
  };
  bindRange('set-sens', 'sens', (v) => v.toFixed(2) + '×');
  bindRange('set-dead', 'deadzone', (v) => Math.round(v * 100) + '%');
  bindRange('set-center', 'center', (v) => Math.round(v * 100) + '%');
  bindRange('set-volume', 'volume', (v) => Math.round(v * 100) + '%', () => FS.Audio.setVolume(S.volume));
  bindRange('set-fov', 'fov', (v) => Math.round(v) + '°', resize);
  $('set-invert').checked = S.invertY;
  $('set-invert').addEventListener('change', (e) => { S.invertY = e.target.checked; FS.Settings.save(); });
  $('set-units').value = S.units;
  $('set-units').addEventListener('change', (e) => { S.units = e.target.value; FS.Settings.save(); });
  $('set-quality').value = S.quality;
  $('set-quality').addEventListener('change', (e) => { S.quality = e.target.value; S.shadows = null; $('set-shadows').checked = FS.Settings.quality().shadows; FS.Settings.save(); applyQuality(); });
  $('set-shadows').checked = FS.Settings.quality().shadows;
  $('set-shadows').addEventListener('change', (e) => { S.shadows = e.target.checked; FS.Settings.save(); applyQuality(); });
  $('set-time').value = S.time;
  $('set-time').addEventListener('change', (e) => { S.time = e.target.value; FS.Settings.save(); world.setPreset(S.time); });

  // tela de controles com remapeamento
  function buildControlsScreen() {
    const tb = $('bind-rows');
    tb.innerHTML = '';
    Object.keys(FS.ACTION_LABELS).forEach((a) => {
      const row = document.createElement('div');
      row.className = 'bind-row';
      row.innerHTML = `<span>${FS.ACTION_LABELS[a]}</span>`;
      const btn = document.createElement('button');
      btn.className = 'keycap'; btn.textContent = FS.keyLabel(controls.bindings[a]);
      btn.addEventListener('click', () => {
        btn.textContent = 'pressione uma tecla…'; btn.classList.add('wait');
        controls.startRebind(a, () => buildControlsScreen());
      });
      row.appendChild(btn);
      tb.appendChild(row);
    });
  }
  $('btn-bind-reset').addEventListener('click', () => { controls.resetBindings(); buildControlsScreen(); });

  /* ------------------------------------------------------------ toque / dispositivos */
  function enableTouch() {
    if (document.body.classList.contains('touch')) return;
    document.body.classList.add('touch'); FS.isTouch = true; controls.lockFailed = false; resize();
  }
  if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) enableTouch();
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enableTouch(); }, { passive: true });

  FS.bindStickWidget(controls, $('stick'), stickKnob);
  FS.bindThrottleWidget(controls, $('thr-track'));
  const hold = (id, on, off) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); FS.Audio.unlock(); on(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, () => off && off()));
  };
  hold('tb-gear', () => doAction('gear'));
  hold('tb-flaps', () => doAction('flaps'));
  hold('tb-engine', () => doAction('engine'));
  hold('tb-cam', () => doAction('camera'));
  hold('tb-view', () => doAction('view'));
  hold('tb-dest', () => doAction('destination'));
  hold('tb-brake', () => { controls.uiBrake = true; model.releaseParkBrake(); }, () => { controls.uiBrake = false; });
  hold('tb-rl', () => { controls.uiRudder = -1; }, () => { controls.uiRudder = 0; });
  hold('tb-rr', () => { controls.uiRudder = 1; }, () => { controls.uiRudder = 0; });

  // pausa automática ao perder o foco (evita voo sem controle)
  window.addEventListener('blur', () => { if (game.state === 'flying') openPause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'flying') openPause(); });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (game.state === 'flying' && e.cancelable) e.preventDefault(); }, { passive: false });

  /* -------------------------------------------------------------------- partida */
  applyQuality();
  world.setPreset(S.time);
  spawn();
  syncRender(1);
  showScreen('main');
  FS.Audio.volume = S.volume;
  window.__fs = { game, model, controls, world, hud, camera, scene, aircraft, renderer, startFlight, setCamMode, doAction, openPause, resumeFlight, get fps() { return fps; } };
  requestAnimationFrame((t) => { lastTime = t; frame(t); });
})();
