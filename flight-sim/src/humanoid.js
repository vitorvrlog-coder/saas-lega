/* humanoid.js — personagens 3D low-poly (jogador, sobreviventes, zumbis) com animação procedural. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;

  const geo = {};
  function G(name, make) { return geo[name] || (geo[name] = make()); }
  const matCache = new Map();
  function mat(hex) {
    let m = matCache.get(hex);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: hex }); matCache.set(hex, m); }
    return m;
  }
  function skinHex(t, zombie) {
    const light = new THREE.Color(0xf0c8a6), dark = new THREE.Color(0x4f3322);
    const c = light.lerp(dark, M.clamp(t, 0, 1));
    if (zombie) c.lerp(new THREE.Color(0x7d9a72), 0.55).multiplyScalar(0.85);
    return c.getHex();
  }

  class Humanoid {
    constructor(look, opts) {
      opts = opts || {};
      look = look || {};
      this.zombie = !!opts.zombie;
      const b = look.build || 1;
      const fem = opts.female;
      this.group = new THREE.Group();
      this.body = new THREE.Group();
      this.group.add(this.body);
      const skin = mat(skinHex(look.skin || 0.3, this.zombie));
      const top = mat(this.zombie ? new THREE.Color(look.top || 0x555555).multiplyScalar(0.7).getHex() : look.top || 0x3a5a7a);
      const bottom = mat(look.bottom || 0x2a2a2a);
      const hair = mat(look.hair || 0x2a1a10);
      const shoe = mat(0x1d1d1f);
      const box = (w, h, d, name) => G(name || `b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
      const add = (parent, g, m, x, y, z) => { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
      const sh = fem ? 0.9 : 1;
      // pernas (pivô no quadril)
      this.legL = new THREE.Group(); this.legR = new THREE.Group();
      this.legL.position.set(-0.1 * b, 0.92, 0); this.legR.position.set(0.1 * b, 0.92, 0);
      [this.legL, this.legR].forEach((leg) => {
        add(leg, box(0.17, 0.5, 0.19), bottom, 0, -0.25, 0);
        add(leg, box(0.16, 0.42, 0.17), bottom, 0, -0.66, 0);
        add(leg, box(0.17, 0.08, 0.27), shoe, 0, -0.88, 0.04);
        this.body.add(leg);
      });
      // tronco
      this.torso = new THREE.Group();
      this.torso.position.y = 0.92;
      this.body.add(this.torso);
      add(this.torso, box(0.36 * b, 0.16, 0.22), bottom, 0, 0.06, 0);
      add(this.torso, box(0.42 * b * sh, 0.5, 0.24), top, 0, 0.38, 0);
      add(this.torso, box(0.12, 0.08, 0.12), skin, 0, 0.66, 0);
      // cabeça
      this.head = new THREE.Group();
      this.head.position.y = 0.7;
      this.torso.add(this.head);
      add(this.head, box(0.22, 0.25, 0.23), skin, 0, 0.13, 0);
      add(this.head, box(0.24, 0.07, 0.25), hair, 0, 0.27, -0.005);
      add(this.head, box(0.24, 0.16, 0.06), hair, 0, 0.18, -0.115);
      if ((look.hairLen || 0) >= 1) add(this.head, box(0.25, 0.2, 0.08), hair, 0, 0.08, -0.12);
      if ((look.hairLen || 0) >= 2) add(this.head, box(0.22, 0.22, 0.07), hair, 0, -0.1, -0.13);
      // olhos
      const eye = mat(this.zombie ? 0xd8e0a0 : 0x15151a);
      add(this.head, box(0.04, 0.03, 0.01, 'eye'), eye, -0.055, 0.15, 0.118);
      add(this.head, box(0.04, 0.03, 0.01, 'eye'), eye, 0.055, 0.15, 0.118);
      // braços (pivô no ombro)
      this.armL = new THREE.Group(); this.armR = new THREE.Group();
      this.armL.position.set(-0.27 * b * sh, 0.6, 0); this.armR.position.set(0.27 * b * sh, 0.6, 0);
      [this.armL, this.armR].forEach((arm) => {
        add(arm, box(0.12, 0.32, 0.13), top, 0, -0.15, 0);
        add(arm, box(0.11, 0.3, 0.12), skin, 0, -0.45, 0);
        this.torso.add(arm);
      });
      this.hand = new THREE.Group();
      this.hand.position.set(0, -0.6, 0.02);
      this.armR.add(this.hand);
      this.group.scale.setScalar(b * (fem ? 0.97 : 1.02));
      this.phase = Math.random() * 6;
      this.weaponType = null;
      this.flash = null;
    }

    setWeapon(id) {
      if (this.weaponId === id) return;
      this.weaponId = id;
      while (this.hand.children.length) this.hand.remove(this.hand.children[0]);
      this.flash = null;
      if (!id) { this.weaponType = null; return; }
      const def = FS.Items.ITEMS[id];
      const w = def && def.weapon;
      if (!w) { this.weaponType = null; return; }
      this.weaponType = w.type === 'gun' ? (id === 'pistola' ? 'pistol' : 'rifle') : 'melee';
      const dark = mat(0x222428), wood = mat(0x6a4a2a), metal = mat(0x8a8d92);
      const m = (g, mm, x, y, z) => { const o = new THREE.Mesh(g, mm); o.position.set(x, y, z); this.hand.add(o); return o; };
      if (this.weaponType === 'pistol') m(G('pist', () => new THREE.BoxGeometry(0.05, 0.12, 0.22)), dark, 0, -0.02, 0.1);
      else if (this.weaponType === 'rifle') { m(G('rif', () => new THREE.BoxGeometry(0.06, 0.1, 0.8)), id === 'espingarda' ? wood : dark, 0, 0, 0.3); }
      else {
        const long = id === 'faca' ? 0.3 : 0.8;
        const blade = m(new THREE.BoxGeometry(0.05, 0.05, long), id === 'faca' || id === 'machado' || id === 'pe_de_cabra' || id === 'cano' ? metal : wood, 0, 0, long / 2);
        blade.rotation.x = 0;
        if (id === 'machado') m(G('axe', () => new THREE.BoxGeometry(0.04, 0.2, 0.14)), metal, 0, 0.08, long - 0.05);
      }
      if (this.weaponType !== 'melee') {
        const f = new THREE.Mesh(G('flash', () => new THREE.SphereGeometry(0.09, 6, 4)), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }));
        f.position.set(0, 0, this.weaponType === 'pistol' ? 0.25 : 0.72);
        f.visible = false;
        this.hand.add(f);
        this.flash = f;
      }
    }

    // speed em m/s; action: 'attack' | 'melee' | 'shoot' | 'aim' | 'reload' | 'eat' | 'loot' | 'heal' | 'talk' | 'work' | 'sleep'
    animate(dt, speed, action, opts) {
      opts = opts || {};
      const g = this.group, body = this.body;
      if (opts.dead) {
        body.rotation.x = M.lerp(body.rotation.x, -Math.PI / 2, Math.min(1, dt * 6));
        body.position.y = M.lerp(body.position.y, 0.15, Math.min(1, dt * 6));
        return;
      }
      if (action === 'sleep') { body.rotation.x = -Math.PI / 2; body.position.y = 0.2; return; }
      body.rotation.x = 0; body.position.y = 0;
      const crouch = opts.crouch ? 1 : 0;
      const s = Math.min(1, speed / 2.2);
      const run = Math.min(1, Math.max(0, (speed - 2.5) / 2.5));
      this.phase += dt * (3 + speed * 2.2);
      const sw = Math.sin(this.phase) * (0.55 + run * 0.35) * s;
      this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
      body.position.y = -Math.abs(Math.cos(this.phase)) * 0.04 * s - crouch * 0.32;
      this.legL.rotation.x += crouch * -0.9; this.legR.rotation.x += crouch * -0.9;
      this.torso.rotation.x = crouch * 0.35 + run * 0.15;
      this.armL.rotation.set(-sw * 0.8, 0, 0.05); this.armR.rotation.set(sw * 0.8, 0, -0.05);
      this.torso.rotation.y = 0; this.head.rotation.set(0, 0, 0);
      if (this.zombie) {
        this.armL.rotation.x = -1.35 + Math.sin(this.phase * 0.7) * 0.15; this.armR.rotation.x = -1.25 + Math.cos(this.phase * 0.6) * 0.15;
        this.torso.rotation.x = 0.25; this.head.rotation.z = Math.sin(this.phase * 0.3) * 0.25;
        if (action === 'attack') { this.armL.rotation.x = -1.9; this.armR.rotation.x = -1.9; this.torso.rotation.x = 0.5; }
      } else if (action === 'aim' || action === 'shoot' || this.weaponType && this.weaponType !== 'melee' && opts.armed) {
        const pitch = opts.aimPitch || 0;
        this.armR.rotation.set(-Math.PI / 2 - pitch, 0, 0);
        this.armL.rotation.set(-Math.PI / 2 - pitch + (this.weaponType === 'rifle' ? 0.2 : 0), 0.5, 0);
        if (action === 'shoot') this.armR.rotation.x -= 0.15;
      } else if (action === 'melee') {
        const t = opts.actionT || 0;
        this.armR.rotation.set(-2.4 + (1 - t) * 2.6, 0, 0.3);
        this.torso.rotation.y = -0.3 + (1 - t) * 0.6;
      } else if (action === 'reload') { this.armR.rotation.x = -1.0; this.armL.rotation.x = -1.2; }
      else if (action === 'eat') { this.armR.rotation.x = -2.3; this.armR.rotation.z = 0.5; }
      else if (action === 'loot' || action === 'work' || action === 'heal') { this.torso.rotation.x = 0.6; this.armL.rotation.x = -1.1 + Math.sin(this.phase * 2) * 0.3; this.armR.rotation.x = -1.1 - Math.sin(this.phase * 2) * 0.3; }
      else if (action === 'talk') { this.armR.rotation.x = -0.6 + Math.sin(this.phase * 1.5) * 0.3; this.head.rotation.y = Math.sin(this.phase * 0.5) * 0.2; }
      if (this.flash) { this.flash.visible = action === 'shoot' && (opts.actionT || 0) > 0.05; }
      if (opts.hit) body.rotation.x = -0.2;
      void g;
    }

    dispose() { this.group.parent && this.group.parent.remove(this.group); }
  }

  FS.Humanoid = Humanoid;
})(typeof window !== 'undefined' ? window : globalThis);
