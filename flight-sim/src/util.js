/* util.js — matemática (vetores/quaternions em arrays), ruído e utilidades.
 * Sem dependências: roda no navegador e no Node (para testes da física). */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const sign = (v) => (v < 0 ? -1 : 1);
  const DEG = Math.PI / 180;

  /* ---------- Vetores: [x, y, z] ---------- */
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };

  /* ---------- Quaternions: [x, y, z, w] (mesma convenção do three.js) ---------- */
  const qIdent = () => [0, 0, 0, 1];
  const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
  const qNorm = (q) => {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  };
  const qFromAxisAngle = (axis, angle) => {
    const h = angle * 0.5;
    const s = Math.sin(h);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
  };
  // vetor do corpo -> mundo
  const qRot = (q, v) => {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
    const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
    const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [
      v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
      v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
      v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    ];
  };
  // vetor do mundo -> corpo
  const qRotInv = (q, v) => qRot(qConj(q), v);
  const qSlerp = (a, b, t) => {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (cos < 0) { cos = -cos; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (cos > 0.9995) {
      return qNorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
    }
    const th = Math.acos(cos);
    const s = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / s;
    const wb = Math.sin(t * th) / s;
    return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
  };
  // Orientação a partir de rumo (graus, 0 = norte, horário) — nariz em -Z do corpo
  const qFromHeading = (headingDeg) => qFromAxisAngle([0, 1, 0], -headingDeg * DEG);

  /* ---------- Ruído determinístico ---------- */
  function hash2(ix, iz, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
    const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, octaves, seed) {
    let sum = 0, amp = 0.5, freq = 1, norm_ = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * vnoise(x * freq, z * freq, seed + i * 17);
      norm_ += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm_;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  FS.M = {
    clamp, lerp, smoothstep, sign, DEG,
    add, sub, mul, dot, cross, len, norm,
    qIdent, qMul, qConj, qNorm, qFromAxisAngle, qRot, qRotInv, qSlerp, qFromHeading,
    hash2, vnoise, fbm, mulberry32,
  };
})(typeof window !== 'undefined' ? window : globalThis);
