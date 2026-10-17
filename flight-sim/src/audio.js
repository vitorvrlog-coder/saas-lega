/* audio.js — som procedural (WebAudio): motor, vento, trem, flaps, alertas e toque das rodas.
 * O contexto só é criado/retomado após um gesto do usuário (política de autoplay). */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;

  const Audio_ = {
    ctx: null, ready: false, volume: 0.6, paused: false, nodes: null, alertT: 0,

    unlock() {
      if (!this.ctx) {
        try {
          const C = window.AudioContext || window.webkitAudioContext;
          if (!C) return;
          this.ctx = new C();
          this.build();
        } catch (e) { this.ctx = null; return; }
      }
      if (this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    },

    noiseBuffer() {
      const ctx = this.ctx, len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = w * 0.6 + b0 * 2.2; }
      return buf;
    },

    build() {
      const ctx = this.ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
      this.noise = this.noiseBuffer();
      const src = () => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(); return s; };

      // jato: ruído filtrado + turbina + ronco grave
      const jetF = ctx.createBiquadFilter(); jetF.type = 'bandpass'; jetF.Q.value = 0.8; jetF.frequency.value = 500;
      const jetG = ctx.createGain(); jetG.gain.value = 0;
      src().connect(jetF); jetF.connect(jetG); jetG.connect(master);
      const whine = ctx.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 100;
      const whineF = ctx.createBiquadFilter(); whineF.type = 'lowpass'; whineF.frequency.value = 1100;
      const whineG = ctx.createGain(); whineG.gain.value = 0;
      whine.connect(whineF); whineF.connect(whineG); whineG.connect(master); whine.start();
      const rumbleF = ctx.createBiquadFilter(); rumbleF.type = 'lowpass'; rumbleF.frequency.value = 180;
      const rumbleG = ctx.createGain(); rumbleG.gain.value = 0;
      src().connect(rumbleF); rumbleF.connect(rumbleG); rumbleG.connect(master);
      // vento
      const windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.Q.value = 0.6; windF.frequency.value = 800;
      const windG = ctx.createGain(); windG.gain.value = 0;
      src().connect(windF); windF.connect(windG); windG.connect(master);
      // rolamento das rodas
      const rollF = ctx.createBiquadFilter(); rollF.type = 'lowpass'; rollF.frequency.value = 260;
      const rollG = ctx.createGain(); rollG.gain.value = 0;
      src().connect(rollF); rollF.connect(rollG); rollG.connect(master);

      this.nodes = { master, jetF, jetG, whine, whineG, whineF, rumbleG, windF, windG, rollG };
      this.ready = true;
      this.setVolume(this.volume);
    },

    setVolume(v) {
      this.volume = v;
      if (this.ready) this.nodes.master.gain.setTargetAtTime(this.paused ? 0 : v * 0.55, this.ctx.currentTime, 0.05);
    },
    setPaused(p) { this.paused = p; this.setVolume(this.volume); },

    // mantém o contínuo de acordo com a simulação
    update(m, dt, stallWarn, flags) {
      if (!this.ready) return;
      const n = this.nodes, t = this.ctx.currentTime;
      const rpm = m.crashed ? 0 : m.rpm;
      const ab = M.smoothstep(0.8, 1.0, rpm);
      n.jetG.gain.setTargetAtTime(Math.pow(rpm, 1.4) * 0.5, t, 0.08);
      n.jetF.frequency.setTargetAtTime(300 + rpm * 1700 + ab * 600, t, 0.1);
      n.whine.frequency.setTargetAtTime(70 + rpm * 520, t, 0.1);
      n.whineG.gain.setTargetAtTime(rpm > 0.02 ? 0.025 + rpm * 0.05 : 0, t, 0.1);
      n.rumbleG.gain.setTargetAtTime(rpm * 0.28 + ab * 0.35, t, 0.12);
      const V = m.V || 0;
      n.windG.gain.setTargetAtTime(Math.min(0.5, Math.pow(V / 260, 2) * 0.55), t, 0.15);
      n.windF.frequency.setTargetAtTime(500 + V * 5, t, 0.2);
      const rolling = m.onGround && !m.bellyContact ? Math.min(1, m.gs / 60) : 0;
      n.rollG.gain.setTargetAtTime(rolling * 0.32, t, 0.1);

      // alertas
      this.alertT -= dt;
      if (this.alertT <= 0 && !this.paused && !m.crashed) {
        if (flags.terrain) { this.beep(1100, 0.12, 0.25, 'square'); this.beep(760, 0.12, 0.25, 'square', 0.14); this.alertT = 0.5; }
        else if (stallWarn > 0.35) { this.beep(930, 0.14, 0.25, 'square'); this.alertT = 0.3; }
        else if (flags.gearWarn) { this.beep(520, 0.18, 0.2, 'triangle'); this.beep(390, 0.18, 0.2, 'triangle', 0.2); this.alertT = 1.1; }
        else if (flags.overspeed || flags.overG) { this.beep(1400, 0.08, 0.2, 'square'); this.alertT = 0.25; }
        else if (flags.overheat) { this.beep(640, 0.2, 0.18, 'sine'); this.alertT = 0.9; }
      }
    },

    beep(freq, dur, gain, type, delay) {
      if (!this.ready || this.ctx.state !== 'running' || this.paused) return;
      const ctx = this.ctx, t0 = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain * this.volume, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.nodes.master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },

    burst(freq, dur, gain, q, delay) {
      if (!this.ready || this.ctx.state !== 'running') return;
      const ctx = this.ctx, t0 = ctx.currentTime + (delay || 0);
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q || 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(this.nodes.master);
      s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
    },

    thump(f0, f1, dur, gain, delay) {
      if (!this.ready || this.ctx.state !== 'running') return;
      const ctx = this.ctx, t0 = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.nodes.master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },

    motor(dur, f, gain) {
      if (!this.ready || this.ctx.state !== 'running') return;
      const ctx = this.ctx, t0 = ctx.currentTime;
      const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.8, t0); o.frequency.linearRampToValueAtTime(f, t0 + dur);
      fl.type = 'lowpass'; fl.frequency.value = 500;
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.2);
      g.gain.setValueAtTime(gain, t0 + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      o.connect(fl); fl.connect(g); g.connect(this.nodes.master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },

    gear() { this.motor(3.6, 70, 0.22); this.thump(90, 40, 0.25, 0.7, 3.6); },
    flaps() { this.motor(1.4, 120, 0.12); },
    touch(sink) {
      const k = M.clamp(sink / 6, 0.15, 1);
      this.burst(900, 0.35, 0.8 * k, 1); this.thump(80, 35, 0.3, 0.9 * k);
    },
    click() { this.beep(660, 0.05, 0.12, 'triangle'); },
    crash() { this.burst(1200, 2.2, 1.0, 0.8); this.thump(120, 25, 1.2, 1.0); },
    engineStart() { this.motor(5.5, 90, 0.18); },
  };

  FS.Audio = Audio_;
})(typeof window !== 'undefined' ? window : globalThis);
