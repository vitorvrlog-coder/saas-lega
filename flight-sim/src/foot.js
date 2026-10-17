/* foot.js — modo sobrevivência: personagem em terceira pessoa, câmera, combate, interações,
 * interface (HUD, inventário, diálogo, comércio, mapa, grupo, base), veículo, entrada no caça e salvamento. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const T = FS.Terrain;
  const TW = FS.Town;
  const IT = FS.Items;
  const SIM = FS.Sim;
  const DLG = FS.Dialogue;
  const SAVE_KEY = 'falcao.survival.v1';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const FIST = { type: 'melee', dmg: 10, range: 1.4, rate: 0.55, noise: 2 };

  const Foot = {
    active: false, panelOpen: null, ready: false,

    init(o) {
      Object.assign(this, o);       // scene, camera, renderer, world, aircraft, model, canvas, settings, onEnterAircraft, onMenu
      this.town = new FS.TownRender(this.scene);
      this.visuals = new Map();
      this.keys = new Set();
      this.camYaw = Math.PI; this.camPitch = -0.15; this.aim = false; this.fire = false;
      this.camPos = new THREE.Vector3(); this.camBlend = 0;
      this.tracers = [];
      this.structMeshes = new Map();
      this.crateMeshes = new Map();
      this.flash = new THREE.SpotLight(0xfff2d0, 0, 38, 0.5, 0.5, 1.2);
      this.scene.add(this.flash, this.flash.target);
      this.buildCar();
      this.buildUI();
      this.bindInput();
      this.ready = true;
    },

    /* =============================================================== jogo */
    newPlayer() {
      return { x: 0, y: TW.ELEV, z: 0, yaw: 0, vy: 0, onGround: true, hp: 100, food: 80, water: 75, energy: 85, stamina: 100, infection: 0, bleeding: 0,
        crouch: false, run: false, inv: new IT.Inventory(25), equipped: 'faca', mags: {}, flashlight: false, dead: false, kills: 0, partner: null, morale: 60,
        inVehicle: false, attackT: 0, reloadT: 0, action: null, actionT: 0, alive: true, armor: false, hitFlash: 0 };
    },

    start(load) {
      const P = (this.P = this.newPlayer());
      const callbacks = {
        onPlayerHit: (d, src) => this.playerHit(d, src),
        onLog: (t, kind) => this.toast(t, kind),
        onSay: (n, t) => this.npcSay(n, t),
        onDeath: (a) => { if (a.kind === 'zombie') this.playSfx('zdie', a); },
        onRemove: (a) => this.removeVisual(a),
        onShot: (n, t, hit) => this.npcShot(n, t, hit),
        onGroan: (z) => this.playSfx('groan', z),
        onCrate: () => {},
        onFlyover: () => { this.flyover = { t: 0 }; },
        onDoor: () => this.playSfx('door'),
      };
      // remove visuais antigos
      this.visuals.forEach((v) => v.dispose()); this.visuals.clear();
      this.structMeshes.forEach((m) => this.scene.remove(m)); this.structMeshes.clear();
      this.crateMeshes.forEach((m) => this.scene.remove(m)); this.crateMeshes.clear();
      TW.doors.forEach((d) => { d.open = false; d.broken = false; d.bash = 0; d.locked = d.origLocked !== undefined ? d.origLocked : d.locked; d.origLocked = d.locked; });
      TW.containers.forEach((c) => { c.opened = false; c.items = null; });
      SIM.dayLength = (this.settings.dayLength || 24) * 60;
      SIM.init(P, callbacks);
      const home = TW.byId.casaC;
      const sp = TW.randomRoomPoint(home, M.mulberry32(5), 1) || home.inside;
      Object.assign(P, { x: sp.x, y: sp.y || home.floorY(1), z: sp.z });
      P.inv.add('faca'); P.inv.add('agua', 1); P.inv.add('barra', 2); P.inv.add('lanterna'); P.inv.add('bandagem', 1);
      this.car.state = { x: TW.byId.oficina.inside.x + 4, z: TW.byId.oficina.inside.z + 5, y: TW.ELEV + 0.12, yaw: Math.PI, speed: 0, fuel: 0, broken: true };
      this.jetParked();
      if (load) { const ok = this.load(); if (!ok) this.toast('Não foi possível carregar o jogo salvo.', 'warn'); }
      this.placeCar();
      this.camYaw = P.yaw + Math.PI; this.camPitch = -0.2;
      this.active = true;
      this.autosaveT = 120;
      this.ui.root.classList.add('on');
      this.objectiveHint();
      this.updateHud(0);
    },

    jetParked() {
      // o caça do aeroporto fica estacionado no pátio de Vale Verde
      const ap = T.AIRPORTS[0], sp = ap.spawns.apron, w = ap.world(sp.u, sp.w);
      this.model.reset({ x: w[0], z: w[1] }, sp.heading);
    },

    objectiveHint() {
      setTimeout(() => this.toast('Objetivo: encontre comida e água, explore a vila e procure outros sobreviventes.', 'quest'), 1500);
      setTimeout(() => this.toast('Dica: E interage, Tab abre a mochila, M abre o mapa. Na rua, cuidado com o barulho.', 'info'), 5000);
    },

    /* ============================================================== atualização */
    update(dt) {
      if (!this.active) return;
      const P = this.P;
      if (this.panelOpen && this.panelOpen !== 'hud') dt = this.panelPausesTime() ? 0 : dt;
      if (!P.dead && dt > 0) {
        if (P.inVehicle) this.updateCar(dt); else this.updatePlayer(dt);
        this.updateStats(dt);
        SIM.update(dt);
        this.updateCombat(dt);
      }
      this.updateCamera(dt);
      this.syncVisuals(dt);
      this.updateWorldFx(dt);
      this.updateHud(dt);
      if (dt > 0 && (this.autosaveT -= dt) <= 0) { this.autosaveT = 120; this.save(true); }
    },
    // enquanto o jogador pilota o caça, o mundo continua vivo
    backgroundUpdate(dt) {
      if (!this.ready || !this.P) return;
      this.P.x = this.model.p[0]; this.P.z = this.model.p[2]; this.P.y = this.model.p[1];
      SIM.update(dt);
      this.syncVisuals(dt);
      this.town.update(dt, null, this.world.night || 0);
    },
    panelPausesTime() { return ['inv', 'dialog', 'trade', 'map', 'base', 'group', 'note', 'exchange', 'container', 'death'].includes(this.panelOpen); },

    updatePlayer(dt) {
      const P = this.P, k = this.keys;
      const s = this.settings;
      let fx = 0, fz = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      if (this.joy) { fx += this.joy.x; fz += -this.joy.y; }
      const fl = Math.hypot(fx, fz);
      if (fl > 1) { fx /= fl; fz /= fl; }
      const over = P.inv.overweight();
      const wantRun = (k.has('ShiftLeft') || k.has('ShiftRight') || this.runToggle) && !P.crouch && !over && P.stamina > 3 && fl > 0.2;
      P.run = wantRun;
      let speed = P.crouch ? 1.4 : wantRun ? 5.4 : 2.7;
      if (over) speed *= 0.6;
      if (P.hp < 30) speed *= 0.8;
      const inWater = T.heightAt(P.x, P.z) < -0.8 && !TW.inTown(P.x, P.z);
      if (inWater) speed *= 0.45;
      // direção relativa à câmera
      const cy = this.camYaw;
      const dirX = -Math.sin(cy) * fz + Math.cos(cy) * fx;   // câmera olha para -camYaw
      const dirZ = -Math.cos(cy) * fz - Math.sin(cy) * fx;
      const vx = dirX * speed, vz = dirZ * speed;
      P.moving = fl > 0.1 ? speed * Math.min(1, fl) : 0;
      if (fl > 0.1 && !this.aim) P.yaw = Math.atan2(dirX, dirZ);
      if (this.aim) P.yaw = Math.atan2(-Math.sin(cy), -Math.cos(cy));
      let nx = P.x + vx * dt, nz = P.z + vz * dt;
      if (TW.inTown(nx, nz)) [nx, nz] = TW.collideCircle(nx, nz, P.y, 0.33, P.crouch ? 1.2 : 1.75);
      else if (T.hitsBuilding(nx, P.y + 1, nz)) { nx = P.x; nz = P.z; }
      P.x = nx; P.z = nz;
      // vertical
      const g0 = TW.groundAt(P.x, P.z, P.y);
      const ground = inWater ? Math.max(g0, -1.3) : g0;
      if ((k.has('Space') || this.jumpReq) && P.onGround && !P.crouch) { P.vy = 4.4; P.onGround = false; P.stamina -= 6; }
      this.jumpReq = false;
      P.vy -= 13 * dt;
      P.y += P.vy * dt;
      if (P.y <= ground + 0.02 || (P.onGround && P.y - ground < 0.45 && P.vy <= 0)) {
        if (!P.onGround && P.vy < -11) this.playerHit((-P.vy - 11) * 7, { kind: 'fall' });
        P.y = ground; P.vy = 0; P.onGround = true;
      } else P.onGround = false;
      if (P.run) P.stamina = Math.max(0, P.stamina - dt * 11); else P.stamina = Math.min(100, P.stamina + dt * (P.food > 20 ? 9 : 4));
      // ruído dos passos (correr chama atenção)
      if (P.moving > 0) { this.stepT = (this.stepT || 0) - dt; if (this.stepT <= 0) { this.stepT = 0.45; SIM.noise(P.x, P.y, P.z, P.run ? 12 : P.crouch ? 1.5 : 4, 'step'); } }
      P.attackT -= dt; P.reloadT -= dt;
      if (P.actionT > 0) { P.actionT -= dt; if (P.actionT <= 0) P.action = null; }
      if (P.reloadT <= 0 && this.reloading) this.finishReload();
      // ataque
      if (this.fire && !this.panelOpen) this.attack();
      // mira desfaz agachar na hora de mirar? não — mantém
      void s;
    },

    updateStats(dt) {
      const P = this.P;
      const h = dt / (SIM.dayLength / 24);
      P.food = Math.max(0, P.food - h * 4.2);
      P.water = Math.max(0, P.water - h * 6);
      P.energy = Math.max(0, P.energy - h * 3.2);
      if (P.food > 40 && P.water > 40 && !P.bleeding && P.infection < 30) P.hp = Math.min(100, P.hp + h * 3);
      if (P.food <= 0 || P.water <= 0) P.hp -= h * 6;
      if (P.energy <= 0) P.stamina = Math.min(P.stamina, 30);
      if (P.infection > 0) { P.infection = Math.min(100, P.infection + h * 5); if (P.infection >= 100) return this.die('A infecção tomou conta de você.'); }
      if (P.bleeding > 0) P.hp -= dt * 0.35 * P.bleeding;
      if (P.hitFlash > 0) P.hitFlash = Math.max(0, P.hitFlash - dt * 2.5);
      if (P.hp <= 0) this.die(this.lastHitCause || 'Você morreu.');
    },

    playerHit(d, src) {
      const P = this.P;
      if (P.dead) return;
      let dmg = d;
      if (P.inv.has('colete') && src && src.kind === 'npc') dmg *= 0.55;
      P.hp -= dmg; P.hitFlash = 1;
      this.playSfx('hurt');
      if (src && src.kind === 'zombie') {
        this.lastHitCause = 'Você foi devorado por zumbis.';
        if (Math.random() < 0.12 && P.infection <= 0) { P.infection = 5; this.toast('Você foi mordido! A infecção começou. Procure antibióticos.', 'warn'); }
        if (Math.random() < 0.25) P.bleeding = Math.min(3, P.bleeding + 1);
      } else if (src && src.kind === 'npc') { this.lastHitCause = 'Você foi morto por ' + src.name + '.'; if (Math.random() < 0.35) P.bleeding = Math.min(3, P.bleeding + 1); }
      else if (src && src.kind === 'fall') this.lastHitCause = 'A queda foi fatal.';
      if (P.hp <= 0) this.die(this.lastHitCause || 'Você morreu.');
    },

    die(cause) {
      const P = this.P;
      if (P.dead) return;
      P.dead = true; P.hp = 0;
      if (document.pointerLockElement) document.exitPointerLock();
      this.openPanel('death', cause);
      this.playSfx('death');
    },

    /* ================================================================ combate */
    weapon() { const w = this.P.equipped && IT.ITEMS[this.P.equipped]; return (w && w.weapon) || FIST; },

    attack() {
      const P = this.P;
      if (P.attackT > 0 || this.reloading || P.inVehicle) return;
      const w = this.weapon();
      if (w.type === 'gun') {
        const mag = P.mags[P.equipped] || 0;
        if (mag <= 0) { if (!this.clickT || this.clickT < performance.now()) { this.playSfx('click'); this.clickT = performance.now() + 400; this.toast('Sem munição no pente. R para recarregar.', 'warn'); } this.fire = this.fire && w.auto; return; }
        P.mags[P.equipped] = mag - 1;
        P.attackT = w.rate; P.action = 'shoot'; P.actionT = 0.12;
        this.shoot(w);
        if (!w.auto) this.fire = false;
      } else {
        P.attackT = w.rate; P.action = 'melee'; P.actionT = 0.35;
        this.fire = false;
        this.playSfx('swing');
        SIM.noise(P.x, P.y, P.z, w.noise, 'melee');
        const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
        let hits = 0;
        for (const a of SIM.agents) {
          if (!a.alive || a === P) continue;
          const dx = a.x - P.x, dz = a.z - P.z, d = Math.hypot(dx, dz);
          if (d > w.range + 0.35 || Math.abs(a.y - P.y) > 1.3) continue;
          if ((dx * fx + dz * fz) / (d || 1) < 0.45) continue;
          if (!TW.losClear(P.x, P.y + 1.2, P.z, a.x, a.y + 1.2, a.z)) continue;
          SIM.damage(a, w.dmg * (0.85 + Math.random() * 0.3) * (P.crouch && a.state !== 'chase' ? 2 : 1), P);
          if (a.kind === 'zombie' && a.alive) { a.x += fx * 0.4; a.z += fz * 0.4; }
          this.playSfx('hit');
          if (++hits >= 2) break;
        }
      }
    },

    shoot(w) {
      const P = this.P, cam = this.camera;
      const o = new THREE.Vector3(); cam.getWorldPosition(o);
      const pellets = w.pellets || 1;
      const moveSpread = P.moving > 0.5 ? 1.8 : 1;
      const spread = w.spread * (this.aim ? 0.5 : 1.4) * moveSpread * (P.crouch ? 0.8 : 1);
      SIM.noise(P.x, P.y, P.z, w.noise, 'gun');
      this.playSfx(P.equipped === 'espingarda' ? 'shotgun' : P.equipped === 'fuzil' ? 'rifle' : 'pistol');
      const pd = new THREE.Vector3(); cam.getWorldDirection(pd);
      const startDist = o.distanceTo(new THREE.Vector3(P.x, P.y + 1.4, P.z));
      for (let k = 0; k < pellets; k++) {
        const d = pd.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2)).normalize();
        let best = null, bt = w.range, head = false;
        for (const a of SIM.agents) {
          if (!a.alive || a.distP > w.range + 5) continue;
          for (const part of [[1.62, 0.17, true], [1.15, 0.42, false], [0.55, 0.3, false]]) {
            const cx = a.x - o.x, cy = a.y + part[0] - o.y, cz = a.z - o.z;
            const tc = cx * d.x + cy * d.y + cz * d.z;
            if (tc < startDist - 0.3 || tc > bt) continue;
            const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
            if (d2 < part[1] * part[1]) { bt = tc; best = a; head = part[2]; break; }
          }
        }
        const end = o.clone().addScaledVector(d, bt);
        // paredes bloqueiam o tiro
        if (!TW.losClear(o.x, o.y, o.z, end.x, end.y, end.z)) {
          let lo = 0, hi = bt;
          for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2, p = o.clone().addScaledVector(d, mid); if (TW.losClear(o.x, o.y, o.z, p.x, p.y, p.z)) lo = mid; else hi = mid; }
          best = null; end.copy(o).addScaledVector(d, lo);
        }
        if (best) {
          const falloff = M.clamp(1.2 - bt / w.range * 0.6, 0.5, 1);
          SIM.damage(best, w.dmg * falloff * (head ? 2.4 : 1), P);
          if (head && best.kind === 'zombie' && !best.alive) this.toast('Tiro na cabeça!', 'info');
        }
        this.addTracer(new THREE.Vector3(P.x + Math.sin(P.yaw) * 0.4, P.y + 1.35, P.z + Math.cos(P.yaw) * 0.4), end);
      }
    },

    reload() {
      const P = this.P, w = this.weapon();
      if (w.type !== 'gun' || this.reloading) return;
      const have = P.inv.count(w.ammo), mag = P.mags[P.equipped] || 0;
      if (mag >= w.mag) return;
      if (!have) { this.toast('Sem munição (' + IT.ITEMS[w.ammo].name + ').', 'warn'); return; }
      this.reloading = true; P.reloadT = 1.6; P.action = 'reload'; P.actionT = 1.6;
      this.playSfx('reload');
    },
    finishReload() {
      const P = this.P, w = this.weapon();
      this.reloading = false;
      if (w.type !== 'gun') return;
      const mag = P.mags[P.equipped] || 0;
      const got = P.inv.remove(w.ammo, w.mag - mag);
      P.mags[P.equipped] = mag + got;
    },

    addTracer(a, b) {
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85 }));
      this.scene.add(line);
      this.tracers.push({ line, t: 0.07 });
    },
    npcShot(n, t, hit) {
      if (n.distP > 70) return;
      const to = new THREE.Vector3(t.x + (hit ? 0 : (Math.random() - 0.5) * 2), t.y + 1.2, t.z + (hit ? 0 : (Math.random() - 0.5) * 2));
      this.addTracer(new THREE.Vector3(n.x, n.y + 1.4, n.z), to);
      this.playSfx(n.weapon === 'espingarda' ? 'shotgun' : n.weapon === 'fuzil' ? 'rifle' : 'pistol', n);
    },
    updateCombat(dt) {
      for (let i = this.tracers.length - 1; i >= 0; i--) {
        const tr = this.tracers[i];
        tr.t -= dt;
        if (tr.t <= 0) { this.scene.remove(tr.line); tr.line.geometry.dispose(); tr.line.material.dispose(); this.tracers.splice(i, 1); }
      }
    },

    /* =============================================================== câmera */
    updateCamera(dt) {
      const P = this.P, cam = this.camera;
      if (P.inVehicle) {
        const c = this.car.state;
        const back = new THREE.Vector3(-Math.sin(c.yaw) * 9, 4, -Math.cos(c.yaw) * 9);
        const target = new THREE.Vector3(c.x, c.y + 1.5, c.z);
        const pos = target.clone().add(back);
        pos.y = Math.max(pos.y, TW.groundAt(pos.x, pos.z, pos.y + 2) + 1.5);
        this.camPos.lerp(pos, Math.min(1, dt * 5));
        cam.position.copy(this.camPos);
        cam.lookAt(target);
        return;
      }
      const pivot = new THREE.Vector3(P.x, P.y + (P.crouch ? 1.15 : 1.6), P.z);
      const dist = this.aim ? 1.9 : 3.6;
      const side = this.aim ? 0.55 : 0.45;
      const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
      const back = new THREE.Vector3(Math.sin(this.camYaw) * cp, -sp, Math.cos(this.camYaw) * cp);
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const shoulder = pivot.clone().addScaledVector(right, side);
      if (!TW.losClear(pivot.x, pivot.y, pivot.z, shoulder.x, shoulder.y, shoulder.z)) shoulder.copy(pivot);
      let want = shoulder.clone().addScaledVector(back, dist);
      // colisão da câmera com paredes e lajes
      if (!TW.losClear(shoulder.x, shoulder.y, shoulder.z, want.x, want.y, want.z)) {
        let lo = 0.2, hi = dist;
        for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2, p = shoulder.clone().addScaledVector(back, mid); if (TW.losClear(shoulder.x, shoulder.y, shoulder.z, p.x, p.y, p.z)) lo = mid; else hi = mid; }
        want = shoulder.clone().addScaledVector(back, Math.max(0.25, lo - 0.25));
      }
      const g = TW.groundAt(want.x, want.z, want.y) + 0.3;
      if (want.y < g) want.y = g;
      this.camPos.lerp(want, this.camBlend < 1 ? 1 : Math.min(1, dt * 18));
      this.camBlend = 1;
      cam.position.copy(this.camPos);
      const look = shoulder.clone().addScaledVector(back, -6);
      cam.lookAt(look);
    },

    /* ========================================================== visuais dos agentes */
    syncVisuals(dt) {
      const P = this.P;
      for (const a of SIM.agents) {
        const near = a.distP < 95 || (!a.alive && a.distP < 60);
        let v = this.visuals.get(a.uid);
        if (near && !v) {
          v = new FS.Humanoid(a.look, { zombie: a.kind === 'zombie', female: a.g === 'f' });
          if (a.kind === 'npc') v.setWeapon(a.weapon);
          this.scene.add(v.group);
          this.visuals.set(a.uid, v);
          v.group.position.set(a.x, a.y, a.z);
        } else if (!near && v) { v.dispose(); this.visuals.delete(a.uid); continue; }
        if (!v) continue;
        v.group.position.lerp(new THREE.Vector3(a.x, a.y, a.z), Math.min(1, dt * 15));
        let dy = a.yaw - v.group.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        v.group.rotation.y += dy * Math.min(1, dt * 10);
        const armed = a.kind === 'npc' && (a.state === 'fight' || a.companion && a.threat);
        v.animate(dt, a.moving || 0, a.state === 'sleep' ? 'sleep' : a.action, { dead: !a.alive, armed, actionT: a.actionT || 0, hit: a.hitT > 0 });
        // esconde quem está em andares ocultos
        const b = TW.buildingAt(P.x, P.z);
        if (b && !P.inVehicle) {
          const fl = TW.floorOf(b, P.y + 0.3), ab = TW.buildingAt(a.x, a.z);
          v.group.visible = !(ab === b && TW.floorOf(b, a.y + 0.3) > fl);
        } else v.group.visible = true;
      }
      // jogador
      if (!this.playerModel) {
        this.playerModel = new FS.Humanoid({ skin: 0.35, hair: 0x2a1a12, hairLen: 0, top: 0x4a5a3a, bottom: 0x2a3040, build: 1 }, {});
        this.scene.add(this.playerModel.group);
      }
      const pm = this.playerModel;
      pm.group.visible = !P.inVehicle && this.active;
      if (pm.group.visible) {
        pm.setWeapon(P.equipped);
        pm.group.position.set(P.x, P.y, P.z);
        pm.group.rotation.y = P.yaw;
        const w = this.weapon();
        pm.animate(dt, P.moving || 0, P.action || (this.aim ? 'aim' : null), { crouch: P.crouch, dead: P.dead, armed: w.type === 'gun' && this.aim, aimPitch: -this.camPitch, actionT: P.actionT });
      }
    },
    removeVisual(a) { const v = this.visuals.get(a.uid); if (v) { v.dispose(); this.visuals.delete(a.uid); } },

    updateWorldFx(dt) {
      const P = this.P;
      this.world.setTimeOfDay(SIM.hour());
      const night = this.world.night || 0;
      this.town.update(dt, P.inVehicle ? null : P, night);
      // lanterna
      const on = P.flashlight && P.inv.has('lanterna') && !P.inVehicle;
      this.flash.intensity = on ? 2.2 : 0;
      if (on) {
        const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
        this.flash.position.set(P.x + Math.sin(P.yaw) * 0.3, P.y + 1.45, P.z + Math.cos(P.yaw) * 0.3);
        this.flash.target.position.copy(this.flash.position).addScaledVector(d, 10);
        this.flash.target.updateMatrixWorld();
      }
      // faróis do carro
      this.car.lights.intensity = P.inVehicle && night > 0.3 ? 2.5 : 0;
      // caixas de suprimentos
      SIM.crates.forEach((c) => {
        if (!this.crateMeshes.has(c.id)) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), new THREE.MeshLambertMaterial({ color: 0x3a6a3a, emissive: 0x112211 }));
          m.position.set(c.x, TW.ELEV + 0.5, c.z); this.scene.add(m); this.crateMeshes.set(c.id, m);
        }
        const m = this.crateMeshes.get(c.id);
        m.material.color.setHex(c.opened ? 0x2a3a2a : 0x3a7a3a);
      });
      // estruturas da base
      SIM.base.structures.forEach((s) => { if (!this.structMeshes.has(s)) this.makeStructureMesh(s); });
      // sobrevoo
      if (this.flyover) {
        const f = this.flyover; f.t += dt;
        if (!f.mesh) { f.mesh = this.aircraft.root.clone(); f.mesh.scale.setScalar(1); this.scene.add(f.mesh); }
        const x = TW.center.x - 3000 + f.t * 250, z = TW.center.z - 900, y = TW.ELEV + 700;
        f.mesh.position.set(x, y, z); f.mesh.rotation.set(0, -Math.PI / 2, 0);
        if (f.t > 26) { this.scene.remove(f.mesh); this.flyover = null; }
      }
    },

    /* ================================================================ interação */
    findInteract() {
      const P = this.P;
      if (P.inVehicle) return { kind: 'car-exit', label: 'Sair do veículo' };
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
      let best = null, bs = 1e9;
      const consider = (o, d, x, z) => {
        const dx = x - P.x, dz = z - P.z, l = Math.hypot(dx, dz) || 1;
        const facing = (dx * fx + dz * fz) / l;
        const score = d - facing * 0.8;
        if (score < bs) { bs = score; best = o; }
      };
      const boxDist = (b) => Math.hypot(Math.max(b.x0 - P.x, 0, P.x - b.x1), Math.max(b.z0 - P.z, 0, P.z - b.z1));
      for (const d of TW.doors) {
        if (Math.abs(P.y - d.y0) > 1.4) continue;
        const dd = boxDist(d);
        if (dd < 1.6) consider({ kind: 'door', o: d, label: d.open ? 'Fechar ' + d.name.toLowerCase() : (d.locked ? 'Destrancar ' : 'Abrir ') + d.name.toLowerCase() }, dd, (d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2);
      }
      for (const c of TW.containers.concat(SIM.crates)) {
        if (Math.abs(P.y - c.y0) > 1.4) continue;
        const dd = boxDist(c);
        if (dd < 1.3) consider({ kind: 'container', o: c, label: (c.opened && c.items && !c.items.length ? 'Vazio: ' : 'Vasculhar ') + c.name.toLowerCase() }, dd, c.x, c.z);
      }
      for (const w of TW.windows) {
        if (w.floor !== 0 || Math.abs(P.y - w.y0) > 2) continue;
        const dd = Math.hypot(w.x - P.x, w.z - P.z);
        if (dd < 1.4) consider({ kind: 'window', o: w, label: 'Pular a janela' }, dd + 0.3, w.x, w.z);
      }
      for (const a of SIM.agents) {
        if (a.kind !== 'npc' || a.distP > 3 || Math.abs(a.y - P.y) > 1.5) continue;
        if (a.alive) consider({ kind: 'npc', o: a, label: 'Conversar com ' + (a.met ? a.name : 'sobrevivente') }, a.distP - 0.5, a.x, a.z);
        else consider({ kind: 'body', o: a, label: 'Revistar corpo de ' + a.name }, a.distP, a.x, a.z);
      }
      const c = this.car.state;
      const dc = Math.hypot(c.x - P.x, c.z - P.z);
      if (dc < 3.2 && Math.abs(c.y - P.y) < 1.5) consider({ kind: 'car', label: c.broken ? 'Consertar a picape' : c.fuel <= 0.05 ? 'Abastecer a picape' : 'Dirigir a picape' }, dc, c.x, c.z);
      const jp = this.model.p, dj = Math.hypot(jp[0] - P.x, jp[2] - P.z);
      if (dj < 9 && !this.model.crashed) consider({ kind: 'jet', label: 'Entrar no caça F-X Falcão' }, dj - 4, jp[0], jp[2]);
      for (const p of TW.props) {
        if (!p.interact) continue;
        const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, dd = Math.hypot(cx - P.x, cz - P.z);
        if (dd < 2.4) consider({ kind: p.interact, o: p, label: p.interact === 'fuel' ? 'Pegar combustível na bomba' : 'Abastecer o gerador da Colina' }, dd, cx, cz);
      }
      if (SIM.base.claimed) { const dd = Math.hypot(SIM.base.x - P.x, SIM.base.z - P.z); if (dd < 25) { /* base acessível pelo menu B */ } }
      return best;
    },

    interact() {
      const P = this.P;
      const it = this.currentInteract;
      if (!it || P.dead) return;
      if (it.kind === 'car-exit') return this.exitCar();
      if (it.kind === 'door') {
        const d = it.o;
        if (d.locked) {
          if (d.locked === 'crowbar' && P.inv.hasTool('crowbar')) { d.locked = null; d.open = true; d.broken = true; SIM.noise(P.x, P.y, P.z, 18, 'door'); this.toast('Você arrombou a porta com o pé de cabra (barulho!).', 'warn'); this.playSfx('door'); return; }
          if (d.locked !== 'crowbar' && P.inv.has(d.locked)) { d.locked = null; d.open = true; this.toast('Você destrancou a porta.', 'info'); this.playSfx('door'); return; }
          this.toast('Trancada. ' + (d.locked === 'crowbar' ? 'Um pé de cabra resolveria.' : 'Precisa da chave certa.'), 'warn'); return;
        }
        d.open = !d.open; this.playSfx('door'); SIM.noise(P.x, P.y, P.z, 3, 'door');
        return;
      }
      if (it.kind === 'container') { SIM.openContainer(it.o, P); this.town.markContainer(it.o); this.openPanel('container', it.o); return; }
      if (it.kind === 'window') {
        const w = it.o;
        const dir = (P.x - w.x) * w.nx + (P.z - w.z) * w.nz > 0 ? -1 : 1;
        const tx = w.x + w.nx * dir * 1.0, tz = w.z + w.nz * dir * 1.0;
        P.x = tx; P.z = tz; P.y = TW.groundAt(tx, tz, P.y + 0.5);
        if (w.broken === false) { w.broken = true; SIM.noise(P.x, P.y, P.z, 15, 'glass'); this.toast('Você quebrou o vidro (barulho).', 'warn'); this.town.glass[w.bid] && (this.town.glass[w.bid][0].visible = this.town.glass[w.bid][0].visible); }
        this.playSfx('swing');
        return;
      }
      if (it.kind === 'npc') { this.openDialog(it.o); return; }
      if (it.kind === 'body') { this.openPanel('container', { name: 'Corpo de ' + it.o.name, items: it.o.inv.items, body: true }); return; }
      if (it.kind === 'car') return this.useCar();
      if (it.kind === 'jet') { this.enterJet(); return; }
      if (it.kind === 'fuel') {
        const f = SIM.factions.mercadores;
        if (f.alive && f.rep < 10) { this.toast('Os Mercadores controlam as bombas. Negocie com Rafael ou ganhe a confiança deles.', 'warn'); return; }
        if (this.lastPump && SIM.t - this.lastPump < 6) { this.toast('A bomba precisa de tempo para encher outro galão.', 'warn'); return; }
        this.lastPump = SIM.t; P.inv.add('galao', 1); this.toast('Você encheu um galão de combustível.', 'info'); return;
      }
      if (it.kind === 'generator') {
        if (!P.inv.has('galao')) { this.toast('Você precisa de um galão de combustível.', 'warn'); return; }
        P.inv.remove('galao', 1);
        const f = SIM.factions.colina; f.res.fuel += 5; SIM.flags.colinaFuel = false; SIM.changeRep('colina', 8);
        SIM.addLog('Você abasteceu o gerador da Colina Verde.', 'faction');
      }
    },

    /* ================================================================= veículo */
    buildCar() {
      const g = new THREE.Group();
      const L = (c) => new THREE.MeshLambertMaterial({ color: c });
      const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
      add(new THREE.BoxGeometry(1.9, 0.7, 4.8), L(0x2f5d8a), 0, 0.75, 0);
      add(new THREE.BoxGeometry(1.8, 0.7, 2.0), L(0x2f5d8a), 0, 1.4, 0.55);
      add(new THREE.BoxGeometry(1.7, 0.5, 1.9), L(0x1a2a35), 0, 1.45, 0.55);
      add(new THREE.BoxGeometry(1.9, 0.4, 2.0), L(0x3a3a3a), 0, 1.15, -1.4);
      const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).rotateZ(Math.PI / 2), wm = L(0x111111);
      [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]].forEach(([x, z]) => add(wg, wm, x, 0.42, z));
      this.scene.add(g);
      const lights = new THREE.SpotLight(0xfff0c0, 0, 45, 0.55, 0.4, 1.2);
      lights.position.set(0, 1.0, 2.4); g.add(lights);
      const tgt = new THREE.Object3D(); tgt.position.set(0, 0.5, 12); g.add(tgt); lights.target = tgt;
      this.car = { group: g, lights, state: { x: 0, y: 0, z: 0, yaw: 0, speed: 0, fuel: 0, broken: true } };
      // colisão do carro estacionado
    },
    placeCar() { const c = this.car.state; this.car.group.position.set(c.x, c.y, c.z); this.car.group.rotation.y = c.yaw; },
    useCar() {
      const P = this.P, c = this.car.state;
      if (c.broken) {
        const mech = SIM.companions().find((n) => n.skills.mech > 0.5);
        if (P.inv.count('pecas') >= 2 && (P.inv.hasTool('repair') || mech)) {
          P.inv.remove('pecas', 2); c.broken = false;
          this.toast((mech ? mech.name.split(' ')[0] + ' consertou' : 'Você consertou') + ' a picape. Agora precisa de combustível.', 'info');
          if (mech) SIM.say(mech, 'Pronto, o motor está novo em folha.');
        } else this.toast('A picape está quebrada: precisa de 2 peças mecânicas e um kit de ferramentas (ou um mecânico no grupo).', 'warn');
        return;
      }
      if (c.fuel <= 0.05) {
        if (P.inv.has('galao')) { P.inv.remove('galao', 1); c.fuel = 10; this.toast('Tanque abastecido.', 'info'); }
        else this.toast('Sem combustível. Traga um galão (posto ou oficina).', 'warn');
        return;
      }
      P.inVehicle = true;
      this.toast('W/S acelera e freia, A/D vira, E sai do veículo. O motor faz barulho!', 'info');
    },
    exitCar() {
      const P = this.P, c = this.car.state;
      if (Math.abs(c.speed) > 2) { this.toast('Pare o veículo antes de sair.', 'warn'); return; }
      P.inVehicle = false;
      const sx = c.x + Math.cos(c.yaw) * 1.8, sz = c.z - Math.sin(c.yaw) * 1.8;
      P.x = sx; P.z = sz; P.y = TW.groundAt(sx, sz, c.y + 1);
      this.camBlend = 0;
    },
    updateCar(dt) {
      const P = this.P, c = this.car.state, k = this.keys;
      let thr = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (this.joy) { thr += -this.joy.y; steer += this.joy.x; }
      thr = M.clamp(thr, -1, 1); steer = M.clamp(steer, -1, 1);
      if (c.fuel <= 0) thr = 0;
      const brake = k.has('Space');
      c.speed += thr * (thr * c.speed < 0 ? 14 : 6.5) * dt;
      c.speed *= 1 - dt * (brake ? 3 : 0.35);
      c.speed = M.clamp(c.speed, -6, 21);
      c.yaw -= steer * dt * M.clamp(c.speed / 6, -1, 1) * 1.6;
      let nx = c.x + Math.sin(c.yaw) * c.speed * dt, nz = c.z + Math.cos(c.yaw) * c.speed * dt;
      const before = [nx, nz];
      if (TW.inTown(nx, nz)) [nx, nz] = TW.collideCircle(nx, nz, c.y, 1.25, 1.6);
      if (Math.hypot(before[0] - nx, before[1] - nz) > 0.05) { if (Math.abs(c.speed) > 8) { this.playSfx('crash'); P.hp -= Math.abs(c.speed) * 0.6; } c.speed *= 0.3; }
      c.x = nx; c.z = nz;
      c.y = TW.inTown(c.x, c.z) ? TW.groundAt(c.x, c.z, c.y + 0.6) : T.groundHeight(c.x, c.z);
      c.fuel = Math.max(0, c.fuel - Math.abs(c.speed) * dt / 350);
      if (Math.abs(c.speed) > 1) { this.engineNoiseT = (this.engineNoiseT || 0) - dt; if (this.engineNoiseT <= 0) { this.engineNoiseT = 0.8; SIM.noise(c.x, c.y, c.z, 28, 'engine'); } }
      // atropelamentos
      for (const a of SIM.agents) {
        if (!a.alive || a.distP > 8) continue;
        if (Math.hypot(a.x - c.x, a.z - c.z) < 1.9 && Math.abs(c.speed) > 4) { SIM.damage(a, Math.abs(c.speed) * 7, P); a.x += Math.sin(c.yaw) * 2; a.z += Math.cos(c.yaw) * 2; c.speed *= 0.85; this.playSfx('hit'); }
      }
      P.x = c.x; P.z = c.z; P.y = c.y; P.moving = 0;
      this.placeCar();
      this.car.speedNow = c.speed;
    },

    enterJet() {
      const m = this.model;
      if (Math.hypot(m.v[0], m.v[2]) > 2) return;
      this.active = false;
      this.ui.root.classList.remove('on');
      if (this.playerModel) this.playerModel.group.visible = false;
      this.flash.intensity = 0;
      this.onEnterAircraft && this.onEnterAircraft();
    },
    exitJet() {
      const m = this.model, P = this.P;
      const left = M.qRot(m.q, [-1, 0, 0]);
      P.x = m.p[0] + left[0] * 5.5; P.z = m.p[2] + left[2] * 5.5;
      P.y = TW.inTown(P.x, P.z) ? TW.groundAt(P.x, P.z, m.p[1]) : T.groundHeight(P.x, P.z);
      P.inVehicle = false;
      this.active = true;
      this.ui.root.classList.add('on');
      this.camBlend = 0;
      this.toast('Você saiu do caça.', 'info');
    },

    /* =============================================================== base */
    makeStructureMesh(s) {
      const d = IT.STRUCTURES[s.type];
      const colors = { barricada: 0x6a4a2a, muro: 0x6a6f75, armadilha: 0x3a3a3a, deposito: 0x5a4a30, enfermaria: 0xe0e0e0, oficina: 0x4a5560, horta: 0x4a7a3a, tanque: 0x3a5a8a, gerador: 0x3a6a3a, torre: 0x6a5030 };
      const geo = new THREE.BoxGeometry(d.size[0], d.size[2], d.size[1]);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colors[s.type] || 0x777777 }));
      m.position.set(s.x, s.y + d.size[2] / 2, s.z); m.rotation.y = s.rot || 0; m.castShadow = true;
      this.scene.add(m);
      this.structMeshes.set(s, m);
      if (d.blocks && !s.wallAdded) {
        const hw = Math.abs(Math.cos(s.rot)) * d.size[0] / 2 + Math.abs(Math.sin(s.rot)) * d.size[1] / 2;
        const hd = Math.abs(Math.sin(s.rot)) * d.size[0] / 2 + Math.abs(Math.cos(s.rot)) * d.size[1] / 2;
        TW.addDynamicWall({ x0: s.x - hw, x1: s.x + hw, z0: s.z - hd, z1: s.z + hd, y0: s.y, y1: s.y + d.size[2], kind: 'built', bid: null, color: [0.5, 0.4, 0.3] });
        s.wallAdded = true;
      }
    },
    build(type) {
      const P = this.P, d = IT.STRUCTURES[type], st = SIM.base.storage;
      for (const id in d.needs) if (P.inv.count(id) + st.count(id) < d.needs[id]) { this.toast('Faltam materiais para ' + d.name + '.', 'warn'); return false; }
      for (const id in d.needs) { let need = d.needs[id]; need -= P.inv.remove(id, need); if (need > 0) st.remove(id, need); }
      const x = P.x + Math.sin(P.yaw) * 2.6, z = P.z + Math.cos(P.yaw) * 2.6;
      const s = { type, x, z, y: TW.groundAt(x, z, P.y + 0.5), rot: -P.yaw, hp: 100 };
      SIM.base.structures.push(s);
      SIM.addLog('Construído: ' + d.name + '.', 'base');
      return true;
    },
    canClaim() {
      const P = this.P, b = TW.buildingAt(P.x, P.z);
      if (!b) return null;
      if (b.faction && !(b.faction === 'corvos' && !SIM.factions.corvos.alive)) return null;
      if (['hospital', 'market', 'police'].includes(b.type)) return null;
      return b;
    },
    sleep() {
      const P = this.P;
      const danger = SIM.agents.some((a) => a.alive && a.kind === 'zombie' && a.distP < 25);
      if (danger) { this.toast('Não dá para dormir com zumbis por perto.', 'warn'); return; }
      const h = SIM.hour(), to = h < 7 ? 7 - h : 31 - h;
      const steps = Math.ceil(to * 4);
      const dt = (to / steps) * (SIM.dayLength / 24);
      for (let i = 0; i < steps; i++) SIM.update(dt);
      P.energy = 100; P.hp = Math.min(100, P.hp + 25); P.stamina = 100;
      P.food = Math.max(0, P.food - to * 2); P.water = Math.max(0, P.water - to * 3);
      SIM.addLog('Você dormiu até o amanhecer.', 'base');
      this.save(true);
    },

    /* =============================================================== salvamento */
    save(auto) {
      const P = this.P;
      if (!P || P.dead) return false;
      const data = {
        v: 1, player: { x: P.x, y: P.y, z: P.z, yaw: P.yaw, hp: P.hp, food: P.food, water: P.water, energy: P.energy, infection: P.infection, bleeding: P.bleeding, inv: P.inv.serialize(), equipped: P.equipped, mags: P.mags, kills: P.kills, partner: P.partner, morale: P.morale },
        sim: SIM.serialize(), car: this.car.state,
        jet: { p: this.model.p, q: this.model.q, gear: this.model.gearPos },
      };
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); if (!auto) this.toast('Jogo salvo.', 'info'); return true; }
      catch (e) { this.toast('Não foi possível salvar (armazenamento indisponível).', 'warn'); return false; }
    },
    hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
    load() {
      let d;
      try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
      if (!d || !d.sim) return false;
      const P = this.P;
      const inv = d.player.inv; delete d.player.inv;
      Object.assign(P, d.player); P.inv.load(inv);
      SIM.load(d.sim);
      Object.assign(this.car.state, d.car || {});
      if (d.jet) { const m = this.model; m.p = d.jet.p.slice(); m.prevP = m.p.slice(); m.q = d.jet.q.slice(); m.prevQ = m.q.slice(); m.v = [0, 0, 0]; m.w = [0, 0, 0]; }
      SIM.base.structures.forEach((s) => { s.wallAdded = false; });
      return true;
    },

    /* ================================================================== som */
    playSfx(name, src) {
      const A = FS.Audio;
      if (!A.ready || A.paused) return;
      let vol = 1;
      if (src && this.P) { const d = Math.hypot(src.x - this.P.x, src.z - this.P.z); vol = M.clamp(1 - d / 60, 0, 1); if (vol <= 0.02) return; }
      switch (name) {
        case 'pistol': A.burst(3000, 0.18, 0.9 * vol); A.thump(160, 50, 0.12, 0.6 * vol); break;
        case 'rifle': A.burst(3500, 0.14, 0.8 * vol); A.thump(140, 45, 0.1, 0.6 * vol); break;
        case 'shotgun': A.burst(1800, 0.4, 1.0 * vol); A.thump(110, 35, 0.25, 0.9 * vol); break;
        case 'swing': A.burst(900, 0.12, 0.25); break;
        case 'hit': A.thump(90, 40, 0.12, 0.6 * vol); break;
        case 'hurt': A.thump(70, 30, 0.2, 0.7); break;
        case 'groan': A.motor(0.9, 55 + Math.random() * 20, 0.08 * vol); break;
        case 'zdie': A.thump(60, 25, 0.3, 0.4 * vol); break;
        case 'door': A.thump(180, 80, 0.15, 0.3); break;
        case 'click': A.beep(1200, 0.04, 0.15, 'square'); break;
        case 'reload': A.beep(700, 0.05, 0.15, 'square'); A.beep(500, 0.05, 0.15, 'square', 0.5); break;
        case 'crash': A.burst(1200, 0.5, 0.8); break;
        case 'death': A.motor(2, 50, 0.2); break;
        default:
      }
    },
    npcSay(n, text) {
      if (!this.settings.voices || !window.speechSynthesis || !this.P || n.distP > 12 || this.panelOpen === 'dialog') return;
      this.speak(n, text);
    },
    speak(n, text) {
      if (!this.settings.voices || !window.speechSynthesis) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/^[^:]+: /, '').replace(/["\[\]]/g, '').split('\n')[0]);
        u.lang = 'pt-BR'; u.pitch = n.voice ? n.voice.pitch : 1; u.rate = n.voice ? n.voice.rate : 1; u.volume = (FS.Audio.volume || 0.6);
        window.speechSynthesis.speak(u);
      } catch (e) { /* sem voz */ }
    },

    /* ================================================================== entrada */
    bindInput() {
      window.addEventListener('keydown', (e) => {
        if (!this.active) return;
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT') return;
        this.keys.add(e.code);
        if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
        if (e.repeat) return;
        if (this.P.dead) return;
        if (this.panelOpen) {
          if (e.code === 'Escape' || (e.code === 'Tab' && this.panelOpen === 'inv') || (e.code === 'KeyI' && this.panelOpen === 'inv') || (e.code === 'KeyM' && this.panelOpen === 'map') || (e.code === 'KeyG' && this.panelOpen === 'group') || (e.code === 'KeyB' && this.panelOpen === 'base')) { e.preventDefault(); this.closePanel(); }
          return;
        }
        switch (e.code) {
          case 'KeyE': this.interact(); break;
          case 'KeyR': this.reload(); break;
          case 'KeyQ': this.quickHeal(); break;
          case 'KeyF': this.P.flashlight = !this.P.flashlight; if (!this.P.inv.has('lanterna')) this.toast('Você não tem lanterna.', 'warn'); break;
          case 'KeyC': case 'ControlLeft': this.P.crouch = !this.P.crouch; break;
          case 'Tab': case 'KeyI': this.openPanel('inv'); break;
          case 'KeyM': this.openPanel('map'); break;
          case 'KeyG': this.openPanel('group'); break;
          case 'KeyB': this.openPanel('base'); break;
          case 'KeyP': this.onPause && this.onPause(); break;
          case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': {
            const ws = this.weaponsOwned();
            const w = ws[+e.code.slice(5) - 1];
            if (w) this.equip(w);
            break;
          }
          default:
        }
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; });
      const cv = this.canvas;
      cv.addEventListener('mousedown', (e) => {
        if (!this.active || this.panelOpen || this.P.dead || this.touch) return;
        if (document.pointerLockElement !== cv) { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* sem bloqueio */ } }
        if (e.button === 0) this.fire = true;
        if (e.button === 2) this.aim = true;
      });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; if (e.button === 2) this.aim = false; });
      window.addEventListener('mousemove', (e) => {
        if (!this.active || this.panelOpen) return;
        const locked = document.pointerLockElement === cv;
        if (!locked && !(e.buttons & 4)) return;
        const s = 0.0024 * (this.settings.sens || 1) * (this.aim ? 0.6 : 1);
        this.camYaw -= e.movementX * s;
        this.camPitch = M.clamp(this.camPitch - e.movementY * s * (this.settings.invertY ? -1 : 1), -1.2, 0.9);
      });
      // toque: arrastar fora dos controles gira a câmera
      let lookId = null, lx = 0, ly = 0;
      cv.addEventListener('pointerdown', (e) => { if (!this.active || e.pointerType !== 'touch') return; this.touch = true; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; });
      cv.addEventListener('pointermove', (e) => {
        if (e.pointerId !== lookId) return;
        const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
        this.camYaw -= dx * 0.006; this.camPitch = M.clamp(this.camPitch - dy * 0.005, -1.2, 0.9);
      });
      const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
      cv.addEventListener('pointerup', endLook); cv.addEventListener('pointercancel', endLook);
    },

    weaponsOwned() { return this.P.inv.items.filter((e) => IT.ITEMS[e.id].weapon).map((e) => e.id).filter((v, i, a) => a.indexOf(v) === i); },
    equip(id) {
      const P = this.P;
      P.equipped = id; this.reloading = false;
      const w = IT.ITEMS[id].weapon;
      if (w && w.type === 'gun' && P.mags[id] === undefined) P.mags[id] = 0;
      this.toast('Equipado: ' + IT.ITEMS[id].name, 'info');
    },
    quickHeal() {
      const P = this.P;
      const order = P.bleeding ? ['bandagem', 'kit_medico'] : P.infection > 0 ? ['antibiotico', 'kit_medico', 'bandagem'] : ['kit_medico', 'bandagem', 'analgesico'];
      const id = order.find((x) => P.inv.has(x));
      if (!id) { this.toast('Nenhum item de cura na mochila.', 'warn'); return; }
      this.useItem(id);
    },
    useItem(id) {
      const P = this.P, d = IT.ITEMS[id];
      if (!d || !P.inv.has(id)) return;
      if (d.weapon) { this.equip(id); return; }
      if (d.cat === 'nota') { const e = P.inv.items.find((x) => x.id === id); this.openPanel('note', e && e.text); return; }
      if (id === 'colete') { this.toast('O colete já protege você enquanto estiver na mochila.', 'info'); return; }
      if (id === 'mochila') { P.inv.remove('mochila', 1); P.inv.capacity += d.capacity; this.toast('Mochila grande equipada (+' + d.capacity + ' kg).', 'info'); return; }
      let used = false;
      if (d.food) { P.food = Math.min(100, P.food + d.food); used = true; }
      if (d.water) { P.water = Math.min(100, P.water + d.water); used = true; }
      if (d.heal) { P.hp = Math.min(100, P.hp + d.heal); used = true; }
      if (d.stopsBleed) { P.bleeding = 0; used = true; }
      if (d.cure) { P.infection = Math.max(0, P.infection - d.cure); used = true; }
      if (d.stamina) { P.stamina = Math.min(100, P.stamina + d.stamina); }
      if (!used) { this.toast('Não dá para usar isso agora.', 'warn'); return; }
      P.inv.remove(id, 1);
      P.action = 'eat'; P.actionT = 1;
      this.toast('Usado: ' + d.name, 'info');
    },

    /* ================================================================== interface */
    buildUI() {
      const root = el('div', '', '');
      root.id = 'foot-ui';
      root.innerHTML = `
        <div class="fu-bars" id="fu-bars"></div>
        <div class="fu-clock" id="fu-clock"></div>
        <div class="fu-cross" id="fu-cross"></div>
        <div class="fu-prompt" id="fu-prompt"></div>
        <div class="fu-weapon" id="fu-weapon"></div>
        <div class="fu-team" id="fu-team"></div>
        <div class="fu-toasts" id="fu-toasts"></div>
        <div class="fu-hit" id="fu-hit"></div>
        <div class="fu-labels" id="fu-labels"></div>
        <div class="fu-panel" id="fu-panel"><div class="fu-panel-in" id="fu-panel-in"></div></div>
        <div class="fu-touch" id="fu-touch">
          <div class="fu-joy" id="fu-joy"><div class="fu-joy-knob" id="fu-joy-knob"></div></div>
          <div class="fu-btns">
            <button data-k="attack" class="big">ATACAR</button><button data-k="aim">MIRAR</button>
            <button data-k="use" class="hl">USAR</button><button data-k="jump">PULAR</button>
            <button data-k="run">CORRER</button><button data-k="crouch">AGACHAR</button>
            <button data-k="reload">RECAR.</button><button data-k="heal">CURAR</button>
            <button data-k="inv">MOCHILA</button><button data-k="map">MAPA</button>
            <button data-k="group">GRUPO</button><button data-k="base">BASE</button>
            <button data-k="light">LUZ</button><button data-k="pause">II</button>
          </div>
        </div>`;
      document.body.appendChild(root);
      this.ui = { root, bars: $('fu-bars'), clock: $('fu-clock'), prompt: $('fu-prompt'), weapon: $('fu-weapon'), team: $('fu-team'), toasts: $('fu-toasts'), hit: $('fu-hit'), labels: $('fu-labels'), panel: $('fu-panel'), panelIn: $('fu-panel-in'), cross: $('fu-cross') };
      this.labelPool = [];
      // joystick virtual
      const joy = $('fu-joy'), knob = $('fu-joy-knob');
      let jid = null;
      const jmove = (e) => {
        const r = joy.getBoundingClientRect(), R = r.width / 2;
        let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
        const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
        this.joy = { x, y }; knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
      };
      joy.addEventListener('pointerdown', (e) => { e.preventDefault(); jid = e.pointerId; try { joy.setPointerCapture(jid); } catch (err) { /* ignora */ } this.touch = true; jmove(e); });
      joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jmove(e); });
      const jend = (e) => { if (e.pointerId === jid) { jid = null; this.joy = null; knob.style.transform = ''; } };
      joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);
      root.querySelectorAll('.fu-btns button').forEach((b) => {
        const k = b.dataset.k;
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault(); FS.Audio.unlock();
          if (!this.active || this.P.dead) return;
          if (this.panelOpen && !['pause'].includes(k)) { this.closePanel(); return; }
          switch (k) {
            case 'attack': this.fire = true; break;
            case 'aim': this.aim = !this.aim; b.classList.toggle('on', this.aim); break;
            case 'use': this.interact(); break;
            case 'jump': this.jumpReq = true; break;
            case 'run': this.runToggle = !this.runToggle; b.classList.toggle('on', this.runToggle); break;
            case 'crouch': this.P.crouch = !this.P.crouch; b.classList.toggle('on', this.P.crouch); break;
            case 'reload': this.reload(); break;
            case 'heal': this.quickHeal(); break;
            case 'inv': this.openPanel('inv'); break;
            case 'map': this.openPanel('map'); break;
            case 'group': this.openPanel('group'); break;
            case 'base': this.openPanel('base'); break;
            case 'light': this.P.flashlight = !this.P.flashlight; break;
            case 'pause': this.onPause && this.onPause(); break;
            default:
          }
        });
        if (k === 'attack') ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => b.addEventListener(t, () => { this.fire = false; }));
      });
      this.ui.panel.addEventListener('click', (e) => {
        const t = e.target.closest('[data-act]');
        if (!t) return;
        this.panelAction(t.dataset.act, t.dataset.arg, t);
      });
    },

    toast(text, kind) {
      if (!this.ui) return;
      const t = el('div', 'fu-toast ' + (kind || 'info'), esc(text));
      this.ui.toasts.prepend(t);
      while (this.ui.toasts.children.length > 5) this.ui.toasts.lastChild.remove();
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 600); }, kind === 'quest' || kind === 'event' ? 7000 : 4500);
    },

    updateHud(dt) {
      const P = this.P, u = this.ui;
      if (!P) return;
      this.hudT = (this.hudT || 0) - dt;
      if (this.hudT <= 0) {
        this.hudT = 0.15;
        const bar = (label, v, cls) => `<div class="fu-bar ${cls || ''}"><span>${label}</span><i style="width:${M.clamp(v, 0, 100)}%"></i></div>`;
        u.bars.innerHTML = bar('VIDA', P.hp, P.hp < 30 ? 'crit' : 'hp') + bar('FOME', P.food, P.food < 25 ? 'crit' : 'food') + bar('SEDE', P.water, P.water < 25 ? 'crit' : 'water') + bar('ENERGIA', P.stamina, 'stam')
          + (P.infection > 0 ? bar('INFECÇÃO', P.infection, 'inf') : '') + (P.bleeding ? '<div class="fu-flag">SANGRANDO — use bandagem (Q)</div>' : '') + (P.inv.overweight() ? '<div class="fu-flag">SOBRECARREGADO</div>' : '') + (P.energy < 20 ? '<div class="fu-flag">EXAUSTO — durma na base</div>' : '');
        const night = this.world.night || 0;
        u.clock.innerHTML = `<b>${SIM.clock()}</b><small>${night > 0.5 ? 'NOITE' : SIM.daylight() > 0.8 ? 'DIA' : 'CREPÚSCULO'}${P.flashlight && P.inv.has('lanterna') ? ' · LANTERNA' : ''}${P.crouch ? ' · AGACHADO' : ''}</small>`;
        const w = this.weapon(), id = P.equipped;
        let wt = id ? IT.ITEMS[id].name : 'Punhos';
        if (w.type === 'gun') wt += ` <b>${P.mags[id] || 0}</b>/${P.inv.count(w.ammo)}`;
        if (this.reloading) wt += ' · RECARREGANDO';
        if (P.inVehicle) { const c = this.car.state; wt = `PICAPE · ${Math.round(Math.abs(c.speed) * 3.6)} km/h · combustível ${Math.round(c.fuel * 10)}%`; }
        u.weapon.innerHTML = wt;
        const comps = SIM.companions();
        u.team.innerHTML = comps.map((n) => `<div><b>${esc(n.name.split(' ')[0])}</b> <i style="width:${n.hp}%"></i><small>${({ follow: 'seguindo', wait: 'esperando', defend: 'defendendo', base: 'na base' })[n.order] || ''}</small></div>`).join('');
        this.currentInteract = this.panelOpen ? null : this.findInteract();
        u.prompt.innerHTML = this.currentInteract ? `<kbd>E</kbd> ${esc(this.currentInteract.label)}` : '';
        u.prompt.classList.toggle('on', !!this.currentInteract);
        u.root.classList.toggle('touch', !!this.touch || document.body.classList.contains('touch'));
      }
      u.hit.style.opacity = P.hitFlash * 0.55;
      u.cross.className = 'fu-cross' + (this.aim ? ' aim' : '') + (this.weapon().type === 'gun' ? ' gun' : '');
      this.updateLabels();
    },

    // nomes e falas sobre os personagens
    updateLabels() {
      const P = this.P, cam = this.camera;
      const W = window.innerWidth, H = window.innerHeight;
      let i = 0;
      const v = new THREE.Vector3();
      for (const a of SIM.agents) {
        if (a.kind !== 'npc' || !a.alive || a.distP > 20) continue;
        const vis = this.visuals.get(a.uid);
        if (!vis || !vis.group.visible) continue;
        v.set(a.x, a.y + 2.05, a.z).project(cam);
        if (v.z > 1) continue;
        let lab = this.labelPool[i];
        if (!lab) { lab = el('div', 'fu-label'); this.ui.labels.appendChild(lab); this.labelPool.push(lab); }
        const f = a.faction && SIM.factions[a.faction];
        const hostile = SIM.hostileToPlayer(a);
        const name = a.met ? a.name.split(' ')[0] + (a.partner === 'player' ? ' ♥' : '') : 'Sobrevivente';
        lab.innerHTML = (a.bubble && a.distP < 18 ? `<div class="fu-bubble">${esc(a.bubble)}</div>` : '') + (a.distP < 12 ? `<span style="color:${hostile ? '#ff6b5f' : a.companion ? '#7ec8ff' : f ? f.color : '#e8e8e8'}">${esc(name)}</span>` : '');
        lab.style.left = ((v.x * 0.5 + 0.5) * W) + 'px'; lab.style.top = ((-v.y * 0.5 + 0.5) * H) + 'px';
        lab.style.display = '';
        i++;
      }
      for (; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
      void P;
    },

    /* ------------------------------------------------------------- painéis */
    openPanel(kind, arg) {
      this.panelOpen = kind; this.panelArg = arg;
      this.fire = false; this.keys.clear();
      if (document.pointerLockElement) { this.unlockingForPanel = true; document.exitPointerLock(); }
      this.ui.panel.classList.add('on');
      this.renderPanel();
    },
    closePanel() {
      if (this.panelOpen === 'death') return;
      this.panelOpen = null; this.trade = null; this.dialogNpc = null;
      this.ui.panel.classList.remove('on');
      if (window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (e) { /* nada */ }
    },

    renderPanel() {
      const P = this.P, k = this.panelOpen, a = this.panelArg;
      let h = '';
      const head = (title, sub) => `<div class="fu-ph"><h3>${title}</h3>${sub ? `<small>${sub}</small>` : ''}<button class="fu-x" data-act="close">×</button></div>`;
      const itemRow = (e, btns) => {
        const d = IT.ITEMS[e.id];
        return `<div class="fu-item"><span class="cat ${d.cat}"></span><b>${esc(d.name)}</b>${e.qty > 1 ? `<em>×${e.qty}</em>` : ''}<small>${(d.w * e.qty).toFixed(1)} kg</small><span class="fu-ibtn">${btns}</span></div>`;
      };
      if (k === 'inv') {
        const tab = this.invTab || 'mochila';
        h += head('MOCHILA', `${P.inv.weight().toFixed(1)} / ${P.inv.capacity} kg · ${P.kills || 0} zumbis abatidos`);
        h += `<div class="fu-tabs"><button data-act="invtab" data-arg="mochila" class="${tab === 'mochila' ? 'on' : ''}">Itens</button><button data-act="invtab" data-arg="criar" class="${tab === 'criar' ? 'on' : ''}">Criar</button></div>`;
        if (tab === 'mochila') {
          const cats = ['arma', 'municao', 'comida', 'agua', 'remedio', 'ferramenta', 'material', 'chave', 'diverso', 'nota'];
          const list = P.inv.items.slice().sort((x, y) => cats.indexOf(IT.ITEMS[x.id].cat) - cats.indexOf(IT.ITEMS[y.id].cat));
          h += '<div class="fu-list">' + (list.length ? list.map((e) => {
            const d = IT.ITEMS[e.id];
            const use = d.weapon ? (P.equipped === e.id ? '<button disabled>Equipado</button>' : `<button data-act="use" data-arg="${e.id}">Equipar</button>`) : ['comida', 'agua', 'remedio', 'nota'].includes(d.cat) || e.id === 'mochila' ? `<button data-act="use" data-arg="${e.id}">${d.cat === 'nota' ? 'Ler' : 'Usar'}</button>` : '';
            return itemRow(e, use + `<button data-act="drop" data-arg="${e.id}">Largar</button>`);
          }).join('') : '<p class="dim">Mochila vazia.</p>') + '</div>';
        } else {
          h += '<div class="fu-list">' + IT.RECIPES.map((r) => {
            const ok = Object.keys(r.needs).every((id) => P.inv.count(id) >= r.needs[id]) && (!r.tool || P.inv.hasTool(r.tool));
            return `<div class="fu-item"><b>${esc(r.name)}</b><small>${Object.keys(r.needs).map((id) => r.needs[id] + '× ' + IT.ITEMS[id].name).join(', ')}${r.tool ? ' + kit de ferramentas' : ''}</small><span class="fu-ibtn"><button data-act="craft" data-arg="${r.id}" ${ok ? '' : 'disabled'}>Criar</button></span></div>`;
          }).join('') + '</div>';
        }
      } else if (k === 'container') {
        const c = a;
        const items = c.items || [];
        h += head(esc(c.name).toUpperCase(), items.length ? items.length + ' tipo(s) de item' : 'Nada de útil aqui');
        h += '<div class="fu-list">' + (items.length ? items.map((e, i) => itemRow(e, `<button data-act="take" data-arg="${i}">Pegar</button>`)).join('') : '<p class="dim">Vazio.</p>') + '</div>';
        h += `<div class="fu-row">${items.length ? '<button class="pri" data-act="takeall">Pegar tudo</button>' : ''}<button data-act="close">Fechar</button></div>`;
      } else if (k === 'dialog') {
        const n = this.dialogNpc, node = this.dialogNode;
        const f = n.faction && SIM.factions[n.faction];
        const rel = n.partner === 'player' ? 'Parceiro(a)' : n.companion ? 'Companheiro(a)' : n.affinity > 60 ? 'Amigo(a)' : n.trust < -20 ? 'Desconfiado(a)' : 'Conhecido(a)';
        h += head(esc(n.name), `${esc(n.specName)} · ${n.age} anos · ${f ? `<span style="color:${f.color}">${esc(f.name)}</span>` : 'sem grupo'} · ${rel}`);
        h += `<div class="fu-meters"><label>Confiança <i style="--v:${(n.trust + 100) / 2}%"></i><b>${Math.round(n.trust)}</b></label><label>Afinidade <i style="--v:${n.affinity}%"></i><b>${Math.round(n.affinity)}</b></label><label>Vida <i style="--v:${n.hp}%"></i><b>${Math.round(n.hp)}</b></label></div>`;
        h += `<div class="fu-say">${esc(node.text).replace(/\n/g, '<br>')}</div>`;
        h += '<div class="fu-opts">' + node.options.map((o, i) => `<button data-act="dlg" data-arg="${i}">${esc(o.label)}</button>`).join('') + '</div>';
      } else if (k === 'trade' || k === 'exchange') {
        const n = this.dialogNpc, tr = this.trade;
        const exch = k === 'exchange';
        const q = exch ? null : DLG.tradeQuote(SIM, n, tr.give, tr.take);
        h += head((exch ? 'EQUIPAMENTO — ' : 'NEGOCIAR — ') + esc(n.name), exch ? 'Passe itens livremente entre vocês' : `Preços ×${q.markup.toFixed(2)} (confiança e reputação reduzem)`);
        const col = (title, list, side) => `<div class="fu-col"><h4>${title}</h4>` + list.map((e, i) => {
          const sel = (side === 'p' ? tr.give : tr.take).find((x) => x.id === e.id);
          return `<div class="fu-item ${sel ? 'sel' : ''}"><b>${esc(IT.ITEMS[e.id].name)}</b><em>×${e.qty}</em><small>${exch ? '' : '$' + IT.ITEMS[e.id].value}</small><span class="fu-ibtn"><button data-act="tsel" data-arg="${side}|${i}">${sel ? sel.qty + ' ✓' : '+'}</button></span></div>`;
        }).join('') + '</div>';
        h += `<div class="fu-cols">${col('Você oferece', P.inv.items, 'p')}${col(esc(DLG.first(n)) + (exch ? ' carrega' : ' oferece'), n.inv.items, 'n')}</div>`;
        if (exch) h += '<div class="fu-row"><button class="pri" data-act="texec">Trocar itens</button><button data-act="tclear">Limpar</button><button data-act="dlgback">Voltar</button></div>';
        else h += `<div class="fu-row"><span class="fu-bal ${q.ok ? 'ok' : ''}">Você dá ${q.give.toFixed(0)} · recebe ${q.take.toFixed(0)}</span><button class="pri" data-act="texec" ${q.ok ? '' : 'disabled'}>Fechar negócio</button><button data-act="tclear">Limpar</button><button data-act="dlgback">Voltar</button></div>`;
      } else if (k === 'map') {
        const tab = this.mapTab || 'mapa';
        h += head('MAPA E DIÁRIO', SIM.clock());
        h += '<div class="fu-tabs">' + [['mapa', 'Mapa'], ['missoes', 'Missões'], ['diario', 'Diário'], ['pessoas', 'Pessoas'], ['faccoes', 'Facções']].map(([id, l]) => `<button data-act="maptab" data-arg="${id}" class="${tab === id ? 'on' : ''}">${l}</button>`).join('') + '</div>';
        if (tab === 'mapa') h += '<canvas id="fu-map" width="640" height="640"></canvas><p class="dim small">Prédios claros podem ser explorados. Cores: facções. ◆ você · ● companheiros · ★ missões · ■ suprimentos · O caça fica no pátio do aeroporto ao norte.</p>';
        else if (tab === 'missoes') {
          const qs = SIM.quests.filter((q) => q.status !== 'offered');
          h += '<div class="fu-list">' + (qs.length ? qs.map((q) => `<div class="fu-q ${q.status}"><b>${esc(q.title)}</b><small>${({ active: 'em andamento', done: 'concluída', failed: 'falhou' })[q.status]} · ${esc(SIM.npcs[q.giver] ? SIM.npcs[q.giver].name : '')}</small><p>${esc(q.desc)}${q.type === 'clear' ? ' (' + Math.max(0, (SIM.killsByBuilding[q.bid] || 0) - q.baseKills) + '/' + q.kills + ')' : q.type === 'fetch' ? ' (' + Math.min(P.inv.count(q.item), q.qty) + '/' + q.qty + ')' : ''}</p></div>`).join('') : '<p class="dim">Nenhuma missão. Converse com os sobreviventes para descobrir como ajudar.</p>') + '</div>';
        } else if (tab === 'diario') h += '<div class="fu-list fu-log">' + SIM.log.map((l) => `<div class="${l.kind}"><small>${l.time}</small> ${esc(l.text)}</div>`).join('') + '</div>';
        else if (tab === 'pessoas') {
          const ns = Object.values(SIM.npcs).filter((n) => n.met);
          h += '<div class="fu-list">' + (ns.length ? ns.map((n) => `<div class="fu-item"><b>${esc(n.name)}</b><small>${esc(n.specName)} · ${n.alive ? (n.companion ? 'no seu grupo' : n.faction ? SIM.factions[n.faction].name : 'sem grupo') : 'morto(a)'} · confiança ${Math.round(n.trust)} · afinidade ${Math.round(n.affinity)}${n.partner && n.partner !== 'player' && SIM.npcs[n.partner] ? ' · junto(a) de ' + SIM.npcs[n.partner].name.split(' ')[0] : n.partner === 'player' ? ' · seu parceiro(a)' : ''}</small></div>`).join('') : '<p class="dim">Você ainda não conheceu ninguém.</p>') + '</div>';
        } else {
          h += '<div class="fu-list">' + Object.values(SIM.factions).map((f) => `<div class="fu-item"><b style="color:${f.color}">${esc(f.name)}</b><small>${f.alive ? esc(f.desc) + ' · membros ' + f.members.length + ' · moral ' + Math.round(f.morale) : 'extinta'}</small><span class="fu-rep ${f.rep >= 40 ? 'ally' : f.rep <= -30 ? 'enemy' : ''}">reputação ${Math.round(f.rep)}</span></div>`).join('') + '</div>';
        }
      } else if (k === 'group') {
        const comps = SIM.companions();
        h += head('GRUPO', comps.length + ' / 3 companheiros');
        h += '<div class="fu-list">' + (comps.length ? comps.map((n) => `<div class="fu-item"><b>${esc(n.name)}</b><small>${esc(n.specName)} · vida ${Math.round(n.hp)} · fome ${Math.round(100 - n.food)}% · confiança ${Math.round(n.trust)}</small><span class="fu-ibtn">${['follow', 'wait', 'defend', 'base'].map((o) => `<button class="${n.order === o ? 'on' : ''}" data-act="order" data-arg="${n.id}|${o}">${({ follow: 'Seguir', wait: 'Esperar', defend: 'Defender', base: 'Base' })[o]}</button>`).join('')}<button data-act="talkto" data-arg="${n.id}">Falar</button></span></div>`).join('') : '<p class="dim">Ninguém viaja com você ainda. Conquiste a confiança dos sobreviventes e convide-os.</p>') + '</div>';
      } else if (k === 'base') {
        const B = SIM.base;
        if (!B.claimed) {
          const b = this.canClaim();
          h += head('BASE', 'Você ainda não tem uma base');
          h += `<p>${b ? 'Você está em <b>' + esc(b.name) + '</b>. Transformar este lugar na sua base?' : 'Entre numa casa, na oficina, no Edifício Aurora ou no galpão (se os Corvos sumirem) para reivindicar uma base.'}</p>`;
          h += `<div class="fu-row">${b ? '<button class="pri" data-act="claim">Reivindicar como base</button>' : ''}<button data-act="close">Fechar</button></div>`;
        } else {
          const tab = this.baseTab || 'status';
          const near = Math.hypot(P.x - B.x, P.z - B.z) < 45;
          h += head('BASE — ' + esc(B.name), near ? 'Você está na base' : 'Você está longe da base (' + Math.round(Math.hypot(P.x - B.x, P.z - B.z)) + ' m)');
          h += '<div class="fu-tabs">' + [['status', 'Situação'], ['construir', 'Construir'], ['deposito', 'Depósito'], ['moradores', 'Moradores']].map(([id, l]) => `<button data-act="basetab" data-arg="${id}" class="${tab === id ? 'on' : ''}">${l}</button>`).join('') + '</div>';
          const st = B.storage;
          const food = st.items.filter((e) => IT.ITEMS[e.id].food).reduce((s, e) => s + e.qty, 0), water = st.items.filter((e) => IT.ITEMS[e.id].water).reduce((s, e) => s + e.qty, 0);
          if (tab === 'status') {
            h += `<div class="fu-stats"><div>Comida<b>${food}</b></div><div>Água<b>${water}</b></div><div>Remédios<b>${st.items.filter((e) => IT.ITEMS[e.id].cat === 'remedio').reduce((s, e) => s + e.qty, 0)}</b></div><div>Defesa<b>${B.defense}</b></div><div>Moral<b>${Math.round(B.morale)}</b></div><div>Moradores<b>${B.residents.length}</b></div></div>`;
            h += `<p class="dim">Moradores consomem comida e água do depósito. Hortas, tanques e funções (agricultor, explorador, médico, guarda) mantêm a comunidade.</p>`;
            h += `<div class="fu-row">${near ? '<button class="pri" data-act="sleep">Dormir até o amanhecer</button>' : ''}<button data-act="save">Salvar jogo</button></div>`;
          } else if (tab === 'construir') {
            h += '<p class="dim">A estrutura é construída à sua frente. Materiais podem vir da mochila ou do depósito.</p><div class="fu-list">' + Object.keys(IT.STRUCTURES).map((id) => {
              const d = IT.STRUCTURES[id];
              const ok = near && Object.keys(d.needs).every((n) => P.inv.count(n) + st.count(n) >= d.needs[n]);
              return `<div class="fu-item"><b>${esc(d.name)}</b><small>${Object.keys(d.needs).map((n) => d.needs[n] + '× ' + IT.ITEMS[n].name).join(', ')}</small><span class="fu-ibtn"><button data-act="build" data-arg="${id}" ${ok ? '' : 'disabled'}>Construir</button></span></div>`;
            }).join('') + '</div>';
          } else if (tab === 'deposito') {
            h += `<div class="fu-row"><button data-act="depall" ${near ? '' : 'disabled'}>Guardar comida, água, remédios e materiais</button></div>`;
            h += '<div class="fu-list">' + (st.items.length ? st.items.map((e) => itemRow(e, near ? `<button data-act="withdraw" data-arg="${e.id}">Retirar</button>` : '')).join('') : '<p class="dim">Depósito vazio.</p>') + '</div>';
          } else {
            const res = B.residents.map((id) => SIM.npcs[id]).filter((n) => n && n.alive);
            const comps = SIM.companions().filter((n) => !B.residents.includes(n.id));
            h += '<div class="fu-list">' + (res.length ? res.map((n) => `<div class="fu-item"><b>${esc(n.name)}</b><small>${esc(n.specName)}</small><span class="fu-ibtn">${['guarda', 'agricultor', 'medico', 'mecanico', 'explorador', 'descanso'].map((j) => `<button class="${(B.jobs[n.id] || 'descanso') === j ? 'on' : ''}" data-act="job" data-arg="${n.id}|${j}">${({ guarda: 'Guarda', agricultor: 'Agricultor', medico: 'Médico', mecanico: 'Mecânico', explorador: 'Explorador', descanso: 'Descanso' })[j]}</button>`).join('')}</span></div>`).join('') : '<p class="dim">Ninguém mora aqui. Mande companheiros para a base pelo menu de grupo.</p>') + '</div>';
            if (comps.length) h += '<p class="dim">Companheiros: use "Base" no menu de grupo (G) para que morem e trabalhem aqui.</p>';
          }
        }
      } else if (k === 'note') {
        h += head('ANOTAÇÃO', '') + `<div class="fu-note">${esc(a || '...')}</div><div class="fu-row"><button data-act="close">Fechar</button></div>`;
      } else if (k === 'death') {
        h += `<div class="fu-death"><h2>VOCÊ MORREU</h2><p>${esc(a || '')}</p><p class="dim">Sobreviveu até ${SIM.clock()} · ${P.kills || 0} zumbis abatidos</p><div class="fu-row">${this.hasSave() ? '<button class="pri" data-act="loadsave">Carregar último jogo salvo</button>' : ''}<button data-act="newgame">Novo jogo</button><button data-act="menu">Menu principal</button></div></div>`;
      }
      this.ui.panelIn.innerHTML = h;
      if (k === 'map' && (this.mapTab || 'mapa') === 'mapa') this.drawMap();
    },

    openDialog(n) {
      this.dialogNpc = n;
      this.dialogNode = DLG.greet(SIM, n, this.P);
      this.openPanel('dialog');
      this.speak(n, this.dialogNode.text);
      n.yaw = Math.atan2(this.P.x - n.x, this.P.z - n.z);
    },

    panelAction(act, arg, btn) {
      const P = this.P;
      FS.Audio.click && FS.Audio.click();
      switch (act) {
        case 'close': this.closePanel(); return;
        case 'invtab': this.invTab = arg; break;
        case 'maptab': this.mapTab = arg; break;
        case 'basetab': this.baseTab = arg; break;
        case 'use': this.useItem(arg); if (this.panelOpen === 'note') return; break;
        case 'drop': {
          const d = IT.ITEMS[arg]; const e = P.inv.items.find((x) => x.id === arg);
          const qty = d.stack ? e.qty : 1;
          P.inv.remove(arg, qty);
          if (P.equipped === arg && !P.inv.has(arg)) P.equipped = null;
          // vira um pequeno monte no chão (container temporário)
          SIM.crates.push({ id: 'drop' + Date.now(), name: 'Itens no chão', kind: 'container', x: P.x, z: P.z, x0: P.x - 0.4, x1: P.x + 0.4, z0: P.z - 0.4, z1: P.z + 0.4, y0: P.y, y1: P.y + 0.3, opened: true, items: [{ id: arg, qty }], room: { locked: false }, color: [0.4, 0.4, 0.3] });
          break;
        }
        case 'craft': {
          const r = IT.RECIPES.find((x) => x.id === arg);
          for (const id in r.needs) P.inv.remove(id, r.needs[id]);
          for (const id in r.gives) P.inv.add(id, r.gives[id]);
          this.toast('Criado: ' + r.name, 'info');
          break;
        }
        case 'take': case 'takeall': {
          const c = this.panelArg, items = c.items || [];
          const idxs = act === 'take' ? [+arg] : items.map((_, i) => i);
          idxs.sort((x, y) => y - x).forEach((i) => {
            const e = items[i]; if (!e) return;
            P.inv.add(e.id, e.qty, e.text ? { text: e.text } : undefined);
            items.splice(i, 1);
            if (IT.ITEMS[e.id].weapon && !P.equipped) this.equip(e.id);
          });
          if (c.body && c.items === undefined) break;
          if (P.inv.overweight()) this.toast('Você está carregando peso demais.', 'warn');
          break;
        }
        case 'dlg': {
          const n = this.dialogNpc, opt = this.dialogNode.options[+arg];
          if (opt.act === 'bye') { this.closePanel(); return; }
          const res = DLG.choose(SIM, n, P, opt.act, opt.arg);
          if (!res) { this.closePanel(); return; }
          if (res.trade || res.exchange) { this.trade = { give: [], take: [] }; this.panelOpen = res.trade ? 'trade' : 'exchange'; break; }
          this.dialogNode = res;
          this.speak(n, res.text);
          break;
        }
        case 'dlgback': this.panelOpen = 'dialog'; this.dialogNode = DLG.node(SIM, this.dialogNpc, P, DLG.first(this.dialogNpc) + ': "Mais alguma coisa?"'); break;
        case 'tsel': {
          const [side, i] = arg.split('|');
          const src = side === 'p' ? P.inv.items : this.dialogNpc.inv.items;
          const e = src[+i]; if (!e) break;
          const list = side === 'p' ? this.trade.give : this.trade.take;
          const sel = list.find((x) => x.id === e.id);
          if (!sel) list.push({ id: e.id, qty: IT.ITEMS[e.id].stack ? Math.min(e.qty, 10) : 1 });
          else if (sel.qty < e.qty && !IT.ITEMS[e.id].weapon) sel.qty = Math.min(e.qty, sel.qty + (IT.ITEMS[e.id].stack ? 10 : 1));
          else list.splice(list.indexOf(sel), 1);
          break;
        }
        case 'tclear': this.trade = { give: [], take: [] }; break;
        case 'texec': {
          const n = this.dialogNpc;
          if (this.panelOpen === 'exchange') {
            this.trade.give.forEach((e) => { P.inv.remove(e.id, e.qty); n.inv.add(e.id, e.qty); if (IT.ITEMS[e.id].weapon) { n.weapon = e.id; const w = IT.ITEMS[e.id].weapon; n.mag = 0; if (w.ammo) n.mag = n.inv.remove(w.ammo, w.mag); } });
            this.trade.take.forEach((e) => { const got = n.inv.remove(e.id, e.qty); P.inv.add(e.id, got); if (n.weapon === e.id && !n.inv.has(e.id)) n.weapon = null; });
            this.toast('Itens trocados com ' + DLG.first(n) + '.', 'info');
          } else if (DLG.executeTrade(SIM, n, P, this.trade.give, this.trade.take)) this.toast('Negócio fechado com ' + DLG.first(n) + '.', 'info');
          this.trade = { give: [], take: [] };
          break;
        }
        case 'order': { const [id, o] = arg.split('|'); const n = SIM.npcs[id]; n.order = o; n.orderPos = { x: P.x, y: P.y, z: P.z }; if (o === 'base') { if (!SIM.base.claimed) { this.toast('Você ainda não tem uma base.', 'warn'); n.order = 'follow'; } else if (!SIM.base.residents.includes(id)) SIM.base.residents.push(id); } break; }
        case 'talkto': this.closePanel(); this.openDialog(SIM.npcs[arg]); return;
        case 'claim': { const b = this.canClaim(); if (b) SIM.claimBase(b); break; }
        case 'build': if (this.build(arg)) { this.closePanel(); return; } break;
        case 'depall': {
          const st = SIM.base.storage;
          P.inv.items.slice().forEach((e) => { const d = IT.ITEMS[e.id]; if (['comida', 'agua', 'remedio', 'material'].includes(d.cat)) { st.add(e.id, e.qty); P.inv.remove(e.id, e.qty); } });
          break;
        }
        case 'withdraw': { const st = SIM.base.storage; const e = st.items.find((x) => x.id === arg); if (e) { const q = IT.ITEMS[arg].stack ? e.qty : 1; st.remove(arg, q); P.inv.add(arg, q); } break; }
        case 'job': { const [id, j] = arg.split('|'); SIM.base.jobs[id] = j; break; }
        case 'sleep': this.closePanel(); this.sleep(); return;
        case 'save': this.save(false); break;
        case 'loadsave': this.ui.panel.classList.remove('on'); this.panelOpen = null; this.start(true); return;
        case 'newgame': this.ui.panel.classList.remove('on'); this.panelOpen = null; this.start(false); return;
        case 'menu': this.ui.panel.classList.remove('on'); this.panelOpen = null; this.active = false; this.ui.root.classList.remove('on'); this.onMenu && this.onMenu(); return;
        default:
      }
      if (this.panelOpen) this.renderPanel();
      void btn;
    },

    drawMap() {
      const cv = document.getElementById('fu-map');
      if (!cv) return;
      const c = cv.getContext('2d'), P = this.P;
      const X0 = TW.X0 - 40, Z0 = TW.Z0 - 40, S = TW.SIZE + 80, sc = cv.width / S;
      const tx = (x) => (x - X0) * sc, tz = (z) => (z - Z0) * sc;
      c.fillStyle = '#20281f'; c.fillRect(0, 0, cv.width, cv.height);
      c.fillStyle = '#3a3d40'; TW.streets.forEach((s) => c.fillRect(tx(s.x0), tz(s.z0), (s.x1 - s.x0) * sc, (s.z1 - s.z0) * sc));
      for (const id in SIM.factions) { const f = SIM.factions[id]; if (!f.alive) continue; c.fillStyle = f.color + '33'; c.beginPath(); c.arc(tx(f.base.x), tz(f.base.z), f.base.r * sc, 0, 7); c.fill(); }
      c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
      TW.buildings.forEach((b) => {
        c.fillStyle = b.faction ? SIM.factions[b.faction].color + 'aa' : '#c9c2b0'; c.fillRect(tx(b.x0), tz(b.z0), b.w * sc, b.d * sc);
        c.fillStyle = '#fff'; c.fillText(b.name.split(' ').slice(0, 2).join(' '), tx((b.x0 + b.x1) / 2), tz((b.z0 + b.z1) / 2) + 4);
      });
      c.fillStyle = '#6a5a40'; TW.props.filter((p) => p.type === 'fence' || p.type === 'tent').forEach((p) => c.fillRect(tx(p.x0), tz(p.z0), Math.max(2, (p.x1 - p.x0) * sc), Math.max(2, (p.z1 - p.z0) * sc)));
      if (SIM.base.claimed) { c.strokeStyle = '#7ec8ff'; c.lineWidth = 3; c.strokeRect(tx(SIM.base.x) - 14, tz(SIM.base.z) - 14, 28, 28); c.fillStyle = '#7ec8ff'; c.fillText('BASE', tx(SIM.base.x), tz(SIM.base.z) - 18); }
      c.fillStyle = '#6dff7a'; SIM.crates.filter((x) => !x.opened).forEach((x) => c.fillRect(tx(x.x) - 4, tz(x.z) - 4, 8, 8));
      // missões ativas
      c.fillStyle = '#ffd34d';
      SIM.quests.filter((q) => q.status === 'active').forEach((q) => {
        let p = null;
        if (q.type === 'clear') { const b = TW.byId[q.bid]; p = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }; }
        else { const g = SIM.npcs[q.type === 'rescue' && !(SIM.npcs[q.target] || {}).rescued ? q.target : q.giver]; if (g && (g.met || q.type === 'rescue')) p = q.type === 'rescue' && !g.met ? { x: g.x + 12, z: g.z - 9 } : g; }
        if (p) c.fillText('★', tx(p.x), tz(p.z));
      });
      SIM.companions().forEach((n) => { c.fillStyle = '#7ec8ff'; c.beginPath(); c.arc(tx(n.x), tz(n.z), 4, 0, 7); c.fill(); });
      Object.values(SIM.npcs).filter((n) => n.met && n.alive && !n.companion).forEach((n) => { c.fillStyle = '#ddd'; c.beginPath(); c.arc(tx(n.x), tz(n.z), 2.5, 0, 7); c.fill(); });
      c.save(); c.translate(tx(P.x), tz(P.z)); c.rotate(-P.yaw + Math.PI); c.fillStyle = '#ff4d4d'; c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(-6, 7); c.fill(); c.restore();
      c.fillStyle = '#9fb'; c.textAlign = 'left'; c.fillText('↑ Aeroporto Vale Verde (caça no pátio) ~' + Math.round(Math.hypot(P.x - this.model.p[0], P.z - this.model.p[2])) + ' m', 8, 16);
    },
  };

  FS.Foot = Foot;
})(typeof window !== 'undefined' ? window : globalThis);
