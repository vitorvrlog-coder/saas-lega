/* settings.js — configurações persistentes (localStorage com fallback em memória). */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const KEY = 'flightSim.settings.v1';
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  const QUALITY = {
    low:    { label: 'Baixa',  radius: 3, treeRadius: 0.5, shadows: false, pixelRatio: 1 },
    medium: { label: 'Média',  radius: 5, treeRadius: 1, shadows: false, pixelRatio: 1.25 },
    high:   { label: 'Alta',   radius: 7, treeRadius: 2, shadows: true,  pixelRatio: 1.75 },
  };

  const defaults = {
    sens: 1.0, deadzone: 0.04, invertY: false, center: 0.35,
    volume: 0.6, quality: coarse ? 'low' : 'medium', shadows: null, time: 'day', units: 'metric',
    fov: 72, startAirport: 'LVV', startPos: 'runway', bindings: {},
  };

  let data = Object.assign({}, defaults);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) data = Object.assign({}, defaults, JSON.parse(raw));
  } catch (e) { /* sem armazenamento: usa memória */ }

  FS.Settings = {
    data, QUALITY,
    save() { try { window.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignora */ } },
    quality() {
      const q = Object.assign({}, QUALITY[data.quality] || QUALITY.medium);
      if (data.shadows !== null && data.shadows !== undefined) q.shadows = !!data.shadows;
      return q;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
