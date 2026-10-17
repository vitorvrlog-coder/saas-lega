/* controls.js — teclado, mouse (Pointer Lock), manche/manete virtuais e toque.
 * Ações discretas (trem, flaps, câmera...) disparam apenas no keydown sem repetição. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;

  const DEFAULT_BINDINGS = {
    throttleUp: 'KeyW', throttleDown: 'KeyS', rudderLeft: 'KeyA', rudderRight: 'KeyD',
    trimDown: 'KeyQ', trimUp: 'KeyE', gear: 'KeyF', flaps: 'KeyG', brake: 'KeyB',
    pause: 'Space', camera: 'KeyC', view: 'KeyV', engine: 'KeyR', destination: 'KeyN', hud: 'KeyH',
  };
  const ACTION_LABELS = {
    throttleUp: 'Aumentar potência', throttleDown: 'Reduzir potência',
    rudderLeft: 'Leme à esquerda', rudderRight: 'Leme à direita',
    trimDown: 'Trim: nariz para baixo', trimUp: 'Trim: nariz para cima',
    gear: 'Trem de pouso (recolher/estender)', flaps: 'Flaps (alternar posição)', brake: 'Freios de roda (segurar)',
    pause: 'Pausar / continuar', camera: 'Alternar câmera externa', view: 'Cockpit ↔ visão externa',
    engine: 'Ligar / desligar motores', destination: 'Selecionar aeroporto de destino', hud: 'Mostrar / ocultar HUD',
  };
  const DISCRETE = ['gear', 'flaps', 'pause', 'camera', 'view', 'engine', 'destination', 'hud'];

  const KEY_NAMES = { Space: 'Espaço', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', Tab: 'Tab', Enter: 'Enter' };
  const keyLabel = (code) => KEY_NAMES[code] || (code ? code.replace(/^Key/, '').replace(/^Digit/, '') : '—');

  class Controls {
    constructor(el, hooks) {
      this.el = el;
      this.hooks = hooks || {};
      this.settings = FS.Settings.data;
      this.bindings = Object.assign({}, DEFAULT_BINDINGS, this.settings.bindings || {});
      this.keys = new Set();
      // estados contínuos
      this.mouseStick = { x: 0, y: 0 };    // entrada acumulada do mouse/teclas
      this.uiStick = null;                 // manche virtual arrastado (mouse/toque)
      this.throttle = 0;
      this.rudder = 0;
      this.trim = 0;
      this.brake = 0;
      this.locked = false;
      this.lockFailed = false;
      this.active = false;                 // true durante o voo (não pausado)
      this.lastMouseMove = 0;
      this.mousePos = null;
      this.out = { x: 0, y: 0 };
      this.cameraMouse = { dx: 0, dy: 0, wheel: 0 };
      this.freeLook = false;               // câmera livre: mouse orbita em vez de pilotar
      this.attach();
    }

    attach() {
      window.addEventListener('keydown', (e) => this.onKeyDown(e));
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => this.releaseAll());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
      document.addEventListener('pointerlockchange', () => this.onLockChange());
      document.addEventListener('pointerlockerror', () => { this.lockFailed = true; this.locked = false; });
      window.addEventListener('mousemove', (e) => this.onMouseMove(e));
      window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      this.el.addEventListener('mousedown', () => { if (this.active) this.requestLock(); });
      this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /* ----- pointer lock ----- */
    requestLock() {
      if (this.locked || !this.el.requestPointerLock) { if (!this.el.requestPointerLock) this.lockFailed = true; return; }
      try {
        const p = this.el.requestPointerLock();
        if (p && p.catch) p.catch(() => { this.lockFailed = true; });
      } catch (err) { this.lockFailed = true; }
    }
    exitLock() {
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (err) { /* ignora */ }
    }
    onLockChange() {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked) {
        // Esc (ou perda do bloqueio) durante o voo: abre o menu e solta todos os comandos
        this.releaseAll();
        if (this.hooks.onUnlock) this.hooks.onUnlock();
      }
    }

    releaseAll() {
      this.keys.clear();
      this.brake = 0;
      this.rudder = 0;
      this.uiStick = null;
    }

    /* ----- eventos ----- */
    onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.rebinding) {
        e.preventDefault();
        if (e.code !== 'Escape') this.setBinding(this.rebinding, e.code);
        const cb = this.rebindDone; this.rebinding = null; this.rebindDone = null;
        if (cb) cb();
        return;
      }
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || (this.active && Object.values(this.bindings).includes(e.code))) e.preventDefault();
      if (e.repeat) return;
      for (const action of DISCRETE) {
        if (this.bindings[action] === e.code) {
          if (this.hooks.onAction) this.hooks.onAction(action);
          return;
        }
      }
      if (e.code === 'Escape' && this.hooks.onEscape) this.hooks.onEscape();
      // B: um toque solta o freio de estacionamento
      if (this.bindings.brake === e.code && this.hooks.onBrakeTap) this.hooks.onBrakeTap();
    }

    onMouseMove(e) {
      this.mousePos = [e.clientX, e.clientY];
      if (!this.active) return;
      if (this.locked) {
        this.lastMouseMove = performance.now();
        if (this.freeLook) { this.cameraMouse.dx += e.movementX; this.cameraMouse.dy += e.movementY; return; }
        const k = 0.0022 * this.settings.sens * (this.settings.invertY ? -1 : 1);
        this.mouseStick.x = M.clamp(this.mouseStick.x + e.movementX * k, -1, 1);
        this.mouseStick.y = M.clamp(this.mouseStick.y + e.movementY * k, -1, 1);
      } else if (this.freeLook && e.buttons) {
        this.cameraMouse.dx += e.movementX; this.cameraMouse.dy += e.movementY;
      }
    }

    onWheel(e) {
      if (!this.active) return;
      e.preventDefault();
      if (this.freeLook) this.cameraMouse.wheel += e.deltaY;
      else this.throttle = M.clamp(this.throttle - Math.sign(e.deltaY) * 0.05, 0, 1);
    }

    /* ----- ligações personalizáveis ----- */
    setBinding(action, code) {
      // evita duplicidade: troca a tecla com a ação que já a usava
      for (const k of Object.keys(this.bindings)) if (this.bindings[k] === code && k !== action) this.bindings[k] = this.bindings[action];
      this.bindings[action] = code;
      this.settings.bindings = Object.assign({}, this.bindings);
      FS.Settings.save();
    }
    resetBindings() {
      this.bindings = Object.assign({}, DEFAULT_BINDINGS);
      this.settings.bindings = {};
      FS.Settings.save();
    }
    startRebind(action, done) { this.rebinding = action; this.rebindDone = done; }

    isDown(action) { return this.keys.has(this.bindings[action]); }

    /* ----- atualização contínua (chamada a cada quadro) ----- */
    update(dt) {
      const s = this.settings;
      if (!this.active) { this.brake = 0; return this.out; }
      const kx = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
      const ky = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0); // ↓ = puxar

      // manche: teclado empurra, mouse acumula, ambos retornam ao centro
      const now = performance.now();
      const mouseIdle = now - this.lastMouseMove > 120;
      const decayMouse = (mouseIdle || this.freeLook || !this.locked ? 1 : 0) * (this.locked ? s.center * 2.4 : 2.5);
      const centerStep = (v, rate) => (Math.abs(v) <= rate * dt ? 0 : v - Math.sign(v) * rate * dt);
      if (this.locked && !this.freeLook) {
        if (mouseIdle) { this.mouseStick.x = centerStep(this.mouseStick.x, decayMouse); this.mouseStick.y = centerStep(this.mouseStick.y, decayMouse); }
      } else if (!this.uiStick) {
        this.mouseStick.x = centerStep(this.mouseStick.x, 2.5); this.mouseStick.y = centerStep(this.mouseStick.y, 2.5);
      }
      if (kx) this.mouseStick.x = M.clamp(this.mouseStick.x + kx * 2.2 * dt, -1, 1);
      if (ky) this.mouseStick.y = M.clamp(this.mouseStick.y + ky * 2.2 * dt, -1, 1);

      let sx = this.mouseStick.x, sy = this.mouseStick.y;
      // sem bloqueio do ponteiro (fallback): o manche segue a posição do mouse na janela
      if (!this.locked && this.lockFailed && this.mousePos && !this.uiStick && !this.freeLook && !FS.isTouch) {
        sx = M.clamp((this.mousePos[0] / window.innerWidth - 0.5) * 2.6, -1, 1);
        sy = M.clamp((this.mousePos[1] / window.innerHeight - 0.5) * 2.6 * (s.invertY ? -1 : 1), -1, 1);
        if (kx) sx = M.clamp(sx + kx, -1, 1);
        if (ky) sy = M.clamp(sy + ky, -1, 1);
      }
      if (this.uiStick) { sx = this.uiStick.x; sy = this.uiStick.y; this.mouseStick.x = sx; this.mouseStick.y = sy; }

      const dz = s.deadzone;
      const shape = (v) => {
        const a = Math.max(0, Math.abs(v) - dz) / (1 - dz);
        return Math.sign(v) * (0.62 * a + 0.38 * a * a * a);
      };
      this.out.x = shape(sx);
      this.out.y = shape(sy);
      this.rawStick = { x: sx, y: sy };

      // manete
      const tu = this.isDown('throttleUp') ? 1 : 0, td = this.isDown('throttleDown') ? 1 : 0;
      this.throttle = M.clamp(this.throttle + (tu - td) * 0.4 * dt, 0, 1);
      // leme
      const rt = M.clamp((this.isDown('rudderRight') ? 1 : 0) - (this.isDown('rudderLeft') ? 1 : 0) + (this.uiRudder || 0), -1, 1);
      if (rt) this.rudder = M.clamp(this.rudder + rt * 3.2 * dt, -1, 1);
      else this.rudder = centerStep(this.rudder, 4.5);
      // trim
      const tr = (this.isDown('trimUp') ? 1 : 0) - (this.isDown('trimDown') ? 1 : 0);
      this.trim = M.clamp(this.trim + tr * 0.1 * dt, -0.4, 0.4);
      // freio
      this.brake = this.isDown('brake') ? 1 : (this.uiBrake ? 1 : 0);
      return this.out;
    }

    resetControls() {
      this.mouseStick.x = this.mouseStick.y = 0;
      this.throttle = 0; this.rudder = 0; this.trim = 0; this.brake = 0; this.uiStick = null;
      this.keys.clear();
    }
  }

  /* --------- Manche e manete na tela (arrastáveis com mouse ou toque) --------- */
  function bindStickWidget(controls, stickEl, knobEl) {
    let pid = null;
    const R = () => stickEl.clientWidth / 2;
    const apply = (e) => {
      const r = stickEl.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (R() * 0.8), dy = (e.clientY - cy) / (R() * 0.8);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      controls.uiStick = { x: dx, y: dy };
    };
    stickEl.addEventListener('pointerdown', (e) => {
      if (!controls.active) return;
      e.preventDefault();
      pid = e.pointerId; stickEl.setPointerCapture(pid); apply(e);
    });
    stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === pid) { e.preventDefault(); apply(e); } });
    const end = (e) => { if (e.pointerId === pid) { pid = null; controls.uiStick = null; } };
    stickEl.addEventListener('pointerup', end);
    stickEl.addEventListener('pointercancel', end);
  }

  function bindThrottleWidget(controls, el) {
    let pid = null;
    const apply = (e) => {
      const r = el.getBoundingClientRect();
      controls.throttle = M.clamp(1 - (e.clientY - r.top - 8) / (r.height - 16), 0, 1);
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; el.setPointerCapture(pid); apply(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) apply(e); });
    const end = (e) => { if (e.pointerId === pid) pid = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  FS.Controls = Controls;
  FS.keyLabel = keyLabel;
  FS.ACTION_LABELS = ACTION_LABELS;
  FS.bindStickWidget = bindStickWidget;
  FS.bindThrottleWidget = bindThrottleWidget;
})(typeof window !== 'undefined' ? window : globalThis);
