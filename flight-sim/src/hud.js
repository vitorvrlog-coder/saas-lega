/* hud.js — instrumentos do painel (canvas do cockpit) e HUD de simulação.
 * Todos os valores vêm do estado real do FlightModel. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const T = FS.Terrain;
  const DEG = M.DEG;
  const MONO = '"Share Tech Mono", Consolas, "Courier New", monospace';
  const GREEN = '#6dffa8';
  const AMBER = '#ffc83a';
  const RED = '#ff4a3d';
  const CYAN = '#5fe0ff';

  const UNITS = {
    metric: { spd: (v) => v * 3.6, spdU: 'km/h', alt: (v) => v, altU: 'm', vs: (v) => v, vsU: 'm/s', dist: (v) => v / 1000, distU: 'km', spdMax: 1500, spdMajor: 250 },
    aviation: { spd: (v) => v * 1.94384, spdU: 'kt', alt: (v) => v * 3.28084, altU: 'ft', vs: (v) => v * 196.85, vsU: 'ft/min', dist: (v) => v / 1852, distU: 'NM', spdMax: 800, spdMajor: 100 },
  };

  const CARD = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const cardinal = (deg) => CARD[Math.round(deg / 45) % 8];

  /* Informações de navegação para o aeroporto selecionado */
  function navInfo(m, ap) {
    if (!ap) return null;
    const dx = ap.x - m.p[0], dz = ap.z - m.p[2];
    const dist = Math.hypot(dx, dz);
    let bearing = Math.atan2(dx, -dz) / DEG;
    if (bearing < 0) bearing += 360;
    // ILS simples: sobre o eixo da pista, na direção mais próxima do rumo atual
    const h = m.heading / DEG;
    const d1 = Math.abs(((h - ap.heading + 540) % 360) - 180);
    const dir = d1 <= 90 ? 1 : -1;
    const l = ap.local(m.p[0], m.p[2]);
    const aim = dir > 0 ? -ap.length / 2 + 300 : ap.length / 2 - 300;
    const along = (aim - l[0]) * dir;                 // distância até o ponto de toque (positivo = antes)
    const offset = l[1] * dir;                        // + = à direita do eixo (visto pelo piloto)
    const gsAlt = along * Math.tan(3 * DEG);
    const active = along > 150 && along < 22000 && Math.abs(offset) < 3500 && Math.min(d1, 180 - d1) < 60;
    return {
      ap, dist, bearing, dir, ils: active ? { along, offset, devV: (m.p[1] - ap.elev) - gsAlt, rwy: dir > 0 ? ap.runwayNumber : ap.reciprocalNumber } : null,
    };
  }

  /* ==================================================== Instrumentos do painel (cockpit) */
  const Instruments = {
    navInfo,

    dial(c, cx, cy, r, title) {
      c.save();
      const g = c.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#1b1f26'); g.addColorStop(1, '#0a0c10');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
      c.strokeStyle = '#4a515c'; c.lineWidth = 4; c.stroke();
      c.fillStyle = '#9aa5b5'; c.font = `bold 13px ${MONO}`; c.textAlign = 'center';
      c.fillText(title, cx, cy - r * 0.45);
      c.restore();
    },

    ticks(c, cx, cy, r, a0, a1, n, majorEvery, labelFn) {
      c.save();
      c.strokeStyle = '#d6dde8'; c.fillStyle = '#d6dde8'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let i = 0; i <= n; i++) {
        const a = M.lerp(a0, a1, i / n) - Math.PI / 2;
        const major = i % majorEvery === 0;
        const r0 = r * (major ? 0.78 : 0.86);
        c.lineWidth = major ? 3 : 1.5;
        c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93); c.stroke();
        if (major && labelFn) {
          c.font = `bold 14px ${MONO}`;
          c.fillText(labelFn(i), cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
        }
      }
      c.restore();
    },

    needle(c, cx, cy, r, a, color, len, w) {
      const ang = a - Math.PI / 2;
      c.save();
      c.strokeStyle = color; c.fillStyle = color; c.lineWidth = w || 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx - Math.cos(ang) * r * 0.12, cy - Math.sin(ang) * r * 0.12); c.lineTo(cx + Math.cos(ang) * r * (len || 0.82), cy + Math.sin(ang) * r * (len || 0.82)); c.stroke();
      c.beginPath(); c.arc(cx, cy, 5, 0, 7); c.fill();
      c.restore();
    },

    drawPanel(c, W, H, m, units, time) {
      const u = UNITS[units] || UNITS.metric;
      c.clearRect(0, 0, W, H);
      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#171a20'); bg.addColorStop(1, '#0c0e12');
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#3a404a'; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
      const r = 78, y = 135, xs = [92, 262, 432, 602, 772, 942];

      /* 1. velocímetro */
      let cx = xs[0];
      this.dial(c, cx, y, r, 'VEL ' + u.spdU);
      const nS = u.spdMax / (u.spdMajor / 5);
      this.ticks(c, cx, y, r, -0.75 * Math.PI, 0.75 * Math.PI, nS, 5, (i) => Math.round((i / 5) * u.spdMajor / (u.spdMajor >= 250 ? 100 : 100) * (u.spdMajor >= 250 ? 1 : 1)) + '');
      const spd = u.spd(m.ias);
      this.needle(c, cx, y, r, M.lerp(-0.75 * Math.PI, 0.75 * Math.PI, M.clamp(spd / u.spdMax, 0, 1)), GREEN);
      this.digital(c, cx, y + r * 0.5, Math.round(spd) + '', GREEN);

      /* 2. indicador de atitude */
      cx = xs[1];
      c.save();
      c.beginPath(); c.arc(cx, y, r, 0, 7); c.clip();
      c.translate(cx, y); c.rotate(m.bank);
      const pp = (m.pitch / DEG) * 2.2;
      c.fillStyle = '#2f79c9'; c.fillRect(-r * 2, -r * 3 + pp, r * 4, r * 3);
      c.fillStyle = '#7a5a34'; c.fillRect(-r * 2, pp, r * 4, r * 3);
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-r * 2, pp); c.lineTo(r * 2, pp); c.stroke();
      c.font = `bold 11px ${MONO}`; c.fillStyle = '#fff'; c.textAlign = 'center';
      for (let p = -30; p <= 30; p += 10) {
        if (!p) continue;
        const yy = pp - p * 2.2, w = p % 20 === 0 ? 30 : 18;
        c.beginPath(); c.moveTo(-w, yy); c.lineTo(w, yy); c.stroke();
        if (p % 20 === 0) c.fillText(Math.abs(p), w + 14, yy + 4);
      }
      c.restore();
      c.strokeStyle = '#4a515c'; c.lineWidth = 4; c.beginPath(); c.arc(cx, y, r, 0, 7); c.stroke();
      c.strokeStyle = AMBER; c.lineWidth = 4; c.beginPath(); c.moveTo(cx - 40, y); c.lineTo(cx - 14, y); c.lineTo(cx - 14, y + 8); c.moveTo(cx + 40, y); c.lineTo(cx + 14, y); c.lineTo(cx + 14, y + 8); c.stroke();
      c.fillStyle = AMBER; c.beginPath(); c.arc(cx, y, 4, 0, 7); c.fill();
      c.fillStyle = '#9aa5b5'; c.font = `bold 13px ${MONO}`; c.textAlign = 'center'; c.fillText('ATITUDE', cx, y - r - 6 + 2);

      /* 3. altímetro */
      cx = xs[2];
      this.dial(c, cx, y, r, 'ALT ' + u.altU);
      const alt = u.alt(m.p[1]);
      const rev = units === 'aviation' ? 1000 : 1000;
      this.ticks(c, cx, y, r, 0, 2 * Math.PI, 50, 5, (i) => (i / 5) % 10 + '');
      this.needle(c, cx, y, r, (alt % rev) / rev * 2 * Math.PI, GREEN, 0.84);
      this.needle(c, cx, y, r, (alt % (rev * 10)) / (rev * 10) * 2 * Math.PI, '#d6dde8', 0.5, 6);
      this.digital(c, cx, y + r * 0.5, Math.round(alt) + '', GREEN);

      /* 4. bússola / rumo */
      cx = xs[3];
      this.dial(c, cx, y, r, 'RUMO');
      c.save();
      c.translate(cx, y); c.rotate(-m.heading);
      c.fillStyle = '#d6dde8'; c.strokeStyle = '#d6dde8'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 10) {
        const a = d * DEG - Math.PI / 2, maj = d % 30 === 0;
        c.lineWidth = maj ? 3 : 1.5;
        c.beginPath(); c.moveTo(Math.cos(a) * r * (maj ? 0.78 : 0.86), Math.sin(a) * r * (maj ? 0.78 : 0.86)); c.lineTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93); c.stroke();
        if (maj) {
          c.save();
          c.translate(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62); c.rotate(d * DEG);
          c.font = `bold 14px ${MONO}`; c.fillStyle = d % 90 === 0 ? AMBER : '#d6dde8';
          c.fillText(d % 90 === 0 ? ['N', 'L', 'S', 'O'][d / 90] : d / 10, 0, 0);
          c.restore();
        }
      }
      if (this.dest) {
        const a = this.dest.bearing * DEG - Math.PI / 2;
        c.fillStyle = CYAN; c.beginPath(); c.arc(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, 6, 0, 7); c.fill();
      }
      c.restore();
      c.fillStyle = AMBER; c.beginPath(); c.moveTo(cx, y - r + 4); c.lineTo(cx - 7, y - r + 18); c.lineTo(cx + 7, y - r + 18); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(cx, y - 24); c.lineTo(cx - 12, y + 14); c.lineTo(cx, y + 6); c.lineTo(cx + 12, y + 14); c.fill();
      this.digital(c, cx, y + r * 0.58, String(Math.round(m.heading / DEG) % 360).padStart(3, '0') + '°', GREEN);

      /* 5. razão de subida/descida */
      cx = xs[4];
      this.dial(c, cx, y, r, 'V.VERT ' + u.vsU);
      const lim = units === 'aviation' ? 6000 : 30;
      const vsv = u.vs(m.vs);
      const va = M.lerp(0, 1, 0);
      c.save(); c.strokeStyle = '#d6dde8'; c.fillStyle = '#d6dde8'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let i = -6; i <= 6; i++) {
        const a = Math.PI + (i / 6) * Math.PI * 0.82 - Math.PI / 2 - Math.PI / 2;
        const major = i % 2 === 0;
        c.lineWidth = major ? 3 : 1.5;
        c.beginPath(); c.moveTo(cx + Math.cos(a - 0) * r * (major ? 0.78 : 0.86), y + Math.sin(a) * r * (major ? 0.78 : 0.86)); c.lineTo(cx + Math.cos(a) * r * 0.93, y + Math.sin(a) * r * 0.93); c.stroke();
        if (major) { c.font = `bold 13px ${MONO}`; c.fillText(Math.abs(i / 6 * lim) + '', cx + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); }
      }
      c.restore();
      const needleA = Math.PI + (M.clamp(vsv / lim, -1, 1)) * Math.PI * 0.82 - Math.PI / 2 - Math.PI / 2 + Math.PI / 2;
      this.needle(c, cx, y, r, needleA, vsv < -1 ? AMBER : GREEN);
      this.digital(c, cx, y + r * 0.5, (vsv >= 0 ? '+' : '') + Math.round(vsv) + '', GREEN);

      /* 6. motor / ângulo de ataque / G */
      cx = xs[5];
      this.dial(c, cx, y, r, 'MOTOR');
      this.bar(c, cx - 58, y - 52, 18, 104, m.input.throttle, 'MAN', GREEN);
      this.bar(c, cx - 24, y - 52, 18, 104, m.rpm, 'RPM', m.rpm > 0.8 ? AMBER : GREEN);
      this.bar(c, cx + 10, y - 52, 18, 104, M.clamp(m.heat, 0, 1), 'TEMP', m.heat > 0.7 ? RED : GREEN);
      const aoa = M.clamp(m.alpha / DEG, -10, 30);
      this.bar(c, cx + 44, y - 52, 18, 104, M.clamp(aoa / 30, 0, 1), 'AOA', aoa > 15 ? RED : GREEN);
      this.digital(c, cx, y + r * 0.52, 'G ' + m.nz.toFixed(1), Math.abs(m.nz) > 7 ? AMBER : GREEN);

      /* anunciadores */
      const lamps = [
        ['TREM', m.gearPos > 0.97 ? GREEN : m.gearPos < 0.03 ? null : AMBER, m.gearDamaged],
        ['FLAPS ' + (['0', 'DEC', 'APR', 'POU'][m.input.flapsIdx]), m.flapsPos > 0.03 ? GREEN : null, false],
        ['FREIO', (m.input.brake > 0 || m.parkBrake) && m.onGround ? AMBER : null, false],
        ['MOTOR', m.enginePhase === 'running' ? GREEN : m.enginePhase === 'starting' ? AMBER : null, false],
        ['ESTOL', m.stallWarn > 0.3 ? RED : null, false],
        ['BAIXA VEL', !m.onGround && m.ias * 3.6 < 250 && m.agl > 20 ? AMBER : null, false],
        ['SOBRECARGA', m.overG || m.overSpeed ? RED : null, false],
      ];
      const lw = 132, lh = 34, ly = H - 52;
      lamps.forEach((l, i) => {
        const lx = 20 + i * (lw + 11);
        c.fillStyle = '#0a0c0f'; c.fillRect(lx, ly, lw, lh);
        c.strokeStyle = '#3a404a'; c.lineWidth = 2; c.strokeRect(lx, ly, lw, lh);
        const on = l[1] && (!l[2] || Math.floor(time * 4) % 2 === 0);
        if (on) { c.fillStyle = l[1] + '55'; c.fillRect(lx + 2, ly + 2, lw - 4, lh - 4); }
        c.fillStyle = on ? l[1] : '#4a515c'; c.font = `bold 16px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(l[0], lx + lw / 2, ly + lh / 2 + 1);
      });
    },

    digital(c, x, y, text, color) {
      c.save();
      c.fillStyle = '#050607'; c.fillRect(x - 38, y - 12, 76, 24);
      c.strokeStyle = '#3a404a'; c.lineWidth = 1.5; c.strokeRect(x - 38, y - 12, 76, 24);
      c.fillStyle = color; c.font = `bold 18px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, x, y + 1);
      c.restore();
    },

    bar(c, x, y, w, h, v, label, color) {
      c.save();
      c.fillStyle = '#050607'; c.fillRect(x, y, w, h);
      c.strokeStyle = '#3a404a'; c.lineWidth = 1.5; c.strokeRect(x, y, w, h);
      c.fillStyle = color; const fh = Math.max(0, Math.min(1, v)) * (h - 4);
      c.fillRect(x + 2, y + h - 2 - fh, w - 4, fh);
      c.fillStyle = '#9aa5b5'; c.font = `bold 10px ${MONO}`; c.textAlign = 'center';
      c.fillText(label, x + w / 2, y + h + 12);
      c.restore();
    },
  };

  /* ============================================================ HUD de simulação (2D) */
  class Hud {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.visible = true;
      this.msgs = [];
      this.dpr = 1;
      this.W = 0; this.H = 0;
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.W = window.innerWidth; this.H = window.innerHeight;
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
    }

    notify(text, color, dur) {
      this.msgs.push({ text, color: color || GREEN, t: 0, dur: dur || 3 });
      if (this.msgs.length > 4) this.msgs.shift();
    }

    clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

    text(c, s, x, y, size, color, align) {
      c.font = `bold ${size}px ${MONO}`;
      c.textAlign = align || 'center'; c.textBaseline = 'middle';
      c.fillStyle = color || GREEN;
      c.fillText(s, x, y);
    }

    draw(m, ctxInfo) {
      const c = this.ctx;
      this.clear();
      if (!this.visible) { this.drawMessages(c, ctxInfo.dt, 0); return; }
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const W = this.W, H = this.H;
      const s = M.clamp(Math.min(W, H) / 700, 0.62, 1.35);
      const u = UNITS[ctxInfo.units] || UNITS.metric;
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 3;
      c.lineWidth = 2 * s; c.strokeStyle = GREEN;

      const cx = W / 2, cy = H / 2;
      this.drawCompass(c, m, ctxInfo, cx, 22 * s + 10, s, W);
      if (ctxInfo.projector) this.drawLadder(c, m, ctxInfo, s);
      this.drawReadouts(c, m, ctxInfo, u, s, W, H);
      this.drawStatus(c, m, ctxInfo, u, s, W, H);
      this.drawNav(c, m, ctxInfo, u, s, W, H);
      c.restore();
      this.drawMessages(c, ctxInfo.dt, s);
    }

    drawCompass(c, m, info, cx, y, s, W) {
      const width = Math.min(W * 0.62, 460 * s), half = width / 2;
      const hdg = m.heading / DEG;
      const ppd = width / 90;       // pixels por grau (90° visíveis)
      c.save();
      c.beginPath(); c.rect(cx - half, y - 16 * s, width, 40 * s); c.clip();
      c.strokeStyle = GREEN; c.fillStyle = GREEN;
      const start = Math.floor((hdg - 50) / 5) * 5;
      for (let d = start; d <= hdg + 50; d += 5) {
        const x = cx + (d - hdg) * ppd;
        const dd = ((d % 360) + 360) % 360;
        const major = dd % 10 === 0;
        c.lineWidth = 1.6 * s;
        c.beginPath(); c.moveTo(x, y + 2 * s); c.lineTo(x, y + (major ? 14 : 8) * s); c.stroke();
        if (dd % 30 === 0) {
          const lab = dd % 90 === 0 ? ['N', 'L', 'S', 'O'][dd / 90] : String(dd / 10).padStart(2, '0');
          this.text(c, lab, x, y + 25 * s, 13 * s, dd % 90 === 0 ? AMBER : GREEN);
        }
      }
      // marcador do destino
      if (info.nav) {
        let diff = ((info.nav.bearing - hdg + 540) % 360) - 180;
        const x = cx + M.clamp(diff, -45, 45) * ppd;
        c.fillStyle = CYAN;
        c.beginPath(); c.moveTo(x, y - 12 * s); c.lineTo(x - 7 * s, y - 2 * s); c.lineTo(x, y + 8 * s); c.lineTo(x + 7 * s, y - 2 * s); c.closePath(); c.fill();
      }
      c.restore();
      c.fillStyle = AMBER;
      c.beginPath(); c.moveTo(cx, y + 2 * s); c.lineTo(cx - 6 * s, y - 9 * s); c.lineTo(cx + 6 * s, y - 9 * s); c.fill();
      c.strokeStyle = GREEN; c.lineWidth = 1.6 * s; c.strokeRect(cx - 28 * s, y - 40 * s + 10, 56 * s, 22 * s);
      this.text(c, String(Math.round(hdg) % 360).padStart(3, '0'), cx, y - 18 * s + 10, 17 * s, GREEN);
    }

    // escada de arfagem conforme o mundo: projeta direções do mundo na tela
    drawLadder(c, m, info, s) {
      const proj = info.projector;
      const hdg = m.heading;
      const out = [0, 0], out2 = [0, 0];
      c.save();
      c.strokeStyle = GREEN; c.fillStyle = GREEN; c.lineWidth = 1.6 * s;
      for (let p = -30; p <= 60; p += 5) {
        const az = p === 0 ? 14 * DEG : 5 * DEG;
        const pr = p * DEG;
        const a1 = hdg - az, a2 = hdg + az;
        const d1 = [Math.sin(a1) * Math.cos(pr), Math.sin(pr), -Math.cos(a1) * Math.cos(pr)];
        const d2 = [Math.sin(a2) * Math.cos(pr), Math.sin(pr), -Math.cos(a2) * Math.cos(pr)];
        if (!proj(d1, out) || !proj(d2, out2)) continue;
        if (Math.abs(out[0] - out2[0]) + Math.abs(out[1] - out2[1]) < 6) continue;
        if (p < 0) c.setLineDash([6 * s, 5 * s]); else c.setLineDash([]);
        c.globalAlpha = p === 0 ? 0.95 : p % 10 === 0 ? 0.75 : 0.35;
        c.beginPath(); c.moveTo(out[0], out[1]); c.lineTo(out2[0], out2[1]); c.stroke();
        if (p % 10 === 0 && p !== 0) {
          this.text(c, Math.abs(p), out[0] - 14 * s, out[1], 11 * s, GREEN);
          this.text(c, Math.abs(p), out2[0] + 14 * s, out2[1], 11 * s, GREEN);
        }
      }
      c.setLineDash([]); c.globalAlpha = 1;
      // vetor velocidade (marcador de trajetória)
      const v = m.v, vl = Math.hypot(v[0], v[1], v[2]);
      if (vl > 5) {
        const dir = [v[0] / vl, v[1] / vl, v[2] / vl];
        if (proj(dir, out)) {
          const x = out[0], y = out[1], r = 9 * s;
          c.strokeStyle = GREEN; c.lineWidth = 2.2 * s;
          c.beginPath(); c.arc(x, y, r, 0, 7); c.moveTo(x - r, y); c.lineTo(x - r * 2.2, y); c.moveTo(x + r, y); c.lineTo(x + r * 2.2, y); c.moveTo(x, y - r); c.lineTo(x, y - r * 1.8); c.stroke();
        }
      }
      // nariz da aeronave
      if (proj(m.fwd, out)) {
        c.strokeStyle = AMBER; c.lineWidth = 2 * s;
        c.beginPath(); c.moveTo(out[0] - 8 * s, out[1]); c.lineTo(out[0] - 3 * s, out[1]); c.moveTo(out[0] + 8 * s, out[1]); c.lineTo(out[0] + 3 * s, out[1]); c.moveTo(out[0], out[1] - 8 * s); c.lineTo(out[0], out[1] - 3 * s); c.stroke();
      }
      c.restore();
    }

    drawReadouts(c, m, info, u, s, W, H) {
      const cy = H * 0.5, bw = 92 * s, bh = 34 * s;
      const xl = Math.max(14, W * 0.5 - Math.min(W * 0.36, 340 * s) - bw / 2) + bw / 2;
      const xr = W - xl;
      const spd = u.spd(m.ias);
      // velocidade
      c.strokeStyle = GREEN; c.lineWidth = 2 * s;
      c.strokeRect(xl - bw / 2, cy - bh / 2, bw, bh);
      this.text(c, Math.round(spd), xl, cy, 22 * s, m.stallWarn > 0.3 ? RED : GREEN);
      this.text(c, 'VEL ' + u.spdU, xl, cy - bh / 2 - 10 * s, 11 * s, GREEN);
      this.text(c, 'M ' + m.mach.toFixed(2), xl, cy + bh / 2 + 12 * s, 13 * s, GREEN);
      this.text(c, 'GS ' + Math.round(u.spd(m.gs)), xl, cy + bh / 2 + 28 * s, 11 * s, '#9fe9bd');
      // altitude
      c.strokeRect(xr - bw / 2, cy - bh / 2, bw, bh);
      const agl = m.agl;
      this.text(c, Math.round(u.alt(m.p[1])), xr, cy, 22 * s, GREEN);
      this.text(c, 'ALT ' + u.altU, xr, cy - bh / 2 - 10 * s, 11 * s, GREEN);
      const vs = u.vs(m.vs);
      this.text(c, (vs >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(vs)) + ' ' + u.vsU, xr, cy + bh / 2 + 12 * s, 13 * s, m.vs < -8 && agl < 400 ? AMBER : GREEN);
      if (agl < 600) this.text(c, 'RAD ' + Math.max(0, Math.round(u.alt(agl))), xr, cy + bh / 2 + 28 * s, 12 * s, agl < 80 ? AMBER : '#9fe9bd');
      // inclinação e arfagem
      this.text(c, 'INCL ' + Math.round(m.bank / DEG) + '°  ARF ' + Math.round(m.pitch / DEG) + '°  AOA ' + (m.alpha / DEG).toFixed(1) + '°  G ' + m.nz.toFixed(1), W / 2, H * 0.5 + 62 * s, 13 * s, GREEN);
      // escala de inclinação (arco)
      const ar = 70 * s, acy = H * 0.5 + 0;
      void ar; void acy;
    }

    drawStatus(c, m, info, u, s, W, H) {
      // estado dos sistemas (canto superior esquerdo, compacto)
      const gear = m.gearDamaged ? 'DANIFICADO' : m.gearPos > 0.97 ? 'ESTENDIDO' : m.gearPos < 0.03 ? 'RECOLHIDO' : m.input.gearCmd ? 'ESTENDENDO' : 'RECOLHENDO';
      const eng = m.enginePhase === 'running' ? 'LIGADO' : m.enginePhase === 'starting' ? 'PARTIDA' : 'DESLIGADO';
      const lines = [
        ['MOTOR ' + eng + '  POT ' + Math.round(m.input.throttle * 100) + '%  RPM ' + Math.round(m.rpm * 100) + '%' + (m.rpm > 0.9 ? ' PÓS-COMB.' : ''), m.enginePhase !== 'running' ? AMBER : m.rpm > 0.9 ? AMBER : GREEN],
        ['TREM ' + gear + '  FLAPS ' + FS.AC.flapsNames[m.input.flapsIdx] + ' ' + Math.round(m.flapsPos * 100) + '%', m.gearDamaged ? RED : m.gearPos > 0.97 ? GREEN : AMBER],
      ];
      if (m.onGround) lines.push(['FREIO ' + (m.parkBrake ? 'DE ESTACIONAMENTO (W para soltar)' : m.input.brake > 0 ? 'ACIONADO' : 'LIVRE'), m.parkBrake || m.input.brake > 0 ? AMBER : '#9fe9bd']);
      else if (Math.abs(m.input.trim) > 0.005) lines.push(['TRIM ' + (m.input.trim > 0 ? '▲' : '▼') + ' ' + Math.abs(Math.round(m.input.trim * 250)) + '%', '#9fe9bd']);
      lines.forEach((e, i) => this.text(c, e[0], 14, 76 * s + i * 16 * s, 12 * s, e[1], 'left'));
      // avisos centrais
      const warns = [];
      if (m.crashed) warns.push(['ACIDENTE', RED]);
      if (m.stallWarn > 0.3 && !m.onGround) warns.push([m.sigma > 0.3 ? 'ESTOL' : 'ESTOL IMINENTE', RED]);
      if (info.terrainWarn) warns.push(['TERRENO — ARREMETER', RED]);
      if (info.gearWarn) warns.push(['TREM DE POUSO!', AMBER]);
      if (!m.onGround && m.ias * 3.6 < 260 && m.agl > 30 && !(m.stallWarn > 0.3)) warns.push(['BAIXA VELOCIDADE', AMBER]);
      if (m.overG) warns.push(['G EXCESSIVO', RED]);
      if (m.overSpeed) warns.push(['VELOCIDADE EXCESSIVA', RED]);
      if (m.overheated) warns.push(['SUPERAQUECIMENTO DO MOTOR', RED]);
      else if (m.heat > 0.7) warns.push(['TEMPERATURA ALTA', AMBER]);
      if (m.integrity < 60) warns.push(['DANOS: ' + Math.max(0, Math.round(m.integrity)) + '%', m.integrity < 30 ? RED : AMBER]);
      const blink = Math.floor(info.time * 3) % 2 === 0;
      warns.forEach((w, i) => { if (blink || w[1] !== RED) this.text(c, w[0], W / 2, H * 0.5 + 108 * s + i * 24 * s, 20 * s, w[1]); });
    }

    drawNav(c, m, info, u, s, W, H) {
      const nav = info.nav;
      if (!nav) return;
      const x = W - 14, y = 76 * s;
      this.text(c, 'DESTINO ' + nav.ap.id + ' · ' + nav.ap.name, x, y, 12 * s, CYAN, 'right');
      const d = u.dist(nav.dist);
      this.text(c, 'DIST ' + d.toFixed(d < 10 ? 1 : 0) + ' ' + u.distU + ' · RUMO ' + String(Math.round(nav.bearing) % 360).padStart(3, '0') + '° · PISTA ' + nav.ap.runwayNumber + '/' + nav.ap.reciprocalNumber, x, y + 16 * s, 12 * s, '#9fe9bd', 'right');
      this.text(c, 'ELEV ' + Math.round(u.alt(nav.ap.elev)) + ' ' + u.altU, x, y + 32 * s, 12 * s, '#9fe9bd', 'right');
      // guia de pouso (ILS simples)
      if (nav.ils) {
        const il = nav.ils, sz = 40 * s, bx = W - 14 - sz - 4, by = y + 52 * s + sz;
        c.strokeStyle = CYAN; c.lineWidth = 1.6 * s;
        c.strokeRect(bx - sz, by - sz, sz * 2, sz * 2);
        c.beginPath(); c.moveTo(bx - sz, by); c.lineTo(bx + sz, by); c.moveTo(bx, by - sz); c.lineTo(bx, by + sz); c.stroke();
        for (const k of [-0.5, 0.5]) { c.beginPath(); c.arc(bx + k * sz, by, 3 * s, 0, 7); c.stroke(); c.beginPath(); c.arc(bx, by + k * sz, 3 * s, 0, 7); c.stroke(); }
        const nx = M.clamp(-il.offset / 250, -1, 1) * sz, ny = M.clamp(il.devV / 80, -1, 1) * sz;
        c.strokeStyle = '#ff5fd2'; c.lineWidth = 3 * s;
        c.beginPath(); c.moveTo(bx + nx, by - sz); c.lineTo(bx + nx, by + sz); c.moveTo(bx - sz, by + ny); c.lineTo(bx + sz, by + ny); c.stroke();
        this.text(c, 'ILS ' + il.rwy + ' · ' + (il.along / 1000).toFixed(1) + ' km', bx, by + sz + 12 * s, 11 * s, CYAN);
      }
    }

    drawMessages(c, dt, s) {
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const W = this.W, H = this.H;
      for (let i = this.msgs.length - 1; i >= 0; i--) { this.msgs[i].t += dt || 0; if (this.msgs[i].t > this.msgs[i].dur) this.msgs.splice(i, 1); }
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 4;
      this.msgs.forEach((m, i) => {
        const a = M.clamp(Math.min(m.t / 0.2, (m.dur - m.t) / 0.5), 0, 1);
        c.globalAlpha = a;
        this.text(c, m.text, W / 2, H * 0.5 - 70 * (s || 1) - (this.msgs.length - 1 - i) * 24 * (s || 1), 17 * (s || 1), m.color);
      });
      c.restore();
    }
  }

  FS.Instruments = Instruments;
  FS.Hud = Hud;
  FS.UNITS = UNITS;
  FS.navInfo = navInfo;
})(typeof window !== 'undefined' ? window : globalThis);
