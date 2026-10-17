/* world.js — mundo 3D: terreno em blocos (chunks), água, céu, nuvens, árvores instanciadas,
 * cidades, estradas e aeroportos. Usa THREE (global) e FS.Terrain (dados). */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const T = FS.Terrain;
  const CS = 1600;       // tamanho do bloco (m)
  const SEG = 40;        // segmentos por bloco (40 m)

  const PRESETS = {
    day: {
      zenith: [0.16, 0.38, 0.78], horizon: [0.72, 0.84, 0.95], fog: [0.72, 0.84, 0.95],
      sun: [0.45, 0.62, 0.33], sunColor: 0xfff1d6, sunI: 0.95, hemiSky: 0xbfd9ff, hemiGround: 0x6d6044, hemiI: 0.62,
      cloud: 0xffffff, water: 0x2272a0, glow: [1, 0.9, 0.7],
    },
    dusk: {
      zenith: [0.10, 0.13, 0.34], horizon: [0.98, 0.58, 0.34], fog: [0.80, 0.50, 0.42],
      sun: [0.80, 0.10, 0.42], sunColor: 0xff9a55, sunI: 0.85, hemiSky: 0x8a78a8, hemiGround: 0x4a3a30, hemiI: 0.50,
      cloud: 0xffc7a0, water: 0x1b4a72, glow: [1, 0.55, 0.25],
    },
  };

  PRESETS.night = {
    zenith: [0.01, 0.02, 0.06], horizon: [0.07, 0.09, 0.16], fog: [0.05, 0.06, 0.11],
    sun: [-0.3, 0.55, -0.4], sunColor: 0x8aa0d8, sunI: 0.16, hemiSky: 0x2a3a5a, hemiGround: 0x101015, hemiI: 0.22,
    cloud: 0x3a4250, water: 0x0a1a2a, glow: [0.15, 0.18, 0.3],
  };
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const lerpHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  function mixPreset(a, b, t) {
    const o = {};
    for (const k in a) {
      if (Array.isArray(a[k])) o[k] = lerp3(a[k], b[k], t);
      else if (k === 'sunI' || k === 'hemiI') o[k] = a[k] + (b[k] - a[k]) * t;
      else o[k] = lerpHex(a[k], b[k], t);
    }
    return o;
  }

  /* ------------------------------------------------------------ utilidades de malha */
  function addColors(geom, r, g, b) {
    const n = geom.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
    geom.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geom;
  }
  function mergeGeoms(list) {
    let vCount = 0, iCount = 0;
    list.forEach((g) => { vCount += g.attributes.position.count; iCount += g.index.count; });
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
    const idx = new Uint16Array(iCount);
    let vo = 0, io = 0;
    list.forEach((g) => {
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      col.set(g.attributes.color.array, vo * 3);
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      vo += g.attributes.position.count; io += g.index.count;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  function treeGeometry() {
    const trunk = addColors(new THREE.CylinderGeometry(0.4, 0.55, 2.6, 5, 1, true).translate(0, 1.3, 0), 0.32, 0.2, 0.1);
    const c1 = addColors(new THREE.ConeGeometry(2.7, 5.8, 6, 1, true).translate(0, 5.0, 0), 0.10, 0.30, 0.12);
    const c2 = addColors(new THREE.ConeGeometry(2.0, 4.8, 6, 1, true).translate(0, 8.0, 0), 0.14, 0.38, 0.15);
    return mergeGeoms([trunk, c1, c2]);
  }
  function boxGeometryColored(topShade, sideShade) {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const n = g.attributes.normal, c = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
      const s = n.getY(i) > 0.5 ? topShade : n.getY(i) < -0.5 ? 0.4 : sideShade;
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }

  /* --------------------------------------------------------------------- cor do relevo */
  function terrainColor(h, slope, x, z, out) {
    const n1 = M.vnoise(x / 38, z / 38, 5);
    const n2 = M.vnoise(x / 260, z / 260, 6);
    let r, g, b;
    if (h < 0) {
      const d = M.clamp(-h / 30, 0, 1);
      r = M.lerp(0.55, 0.06, d); g = M.lerp(0.62, 0.24, d); b = M.lerp(0.45, 0.36, d);
    } else if (h < 3.5) {
      r = 0.76 + n1 * 0.05; g = 0.69 + n1 * 0.05; b = 0.46;
    } else {
      const alt = M.clamp((h - 4) / 600, 0, 1);
      // grama: verde úmido ↔ seco
      r = M.lerp(0.20, 0.46, n2 * 0.9 + n1 * 0.2); g = M.lerp(0.42, 0.50, n2 * 0.7);
      b = M.lerp(0.12, 0.20, n2);
      r = M.lerp(r, 0.30, alt); g = M.lerp(g, 0.36, alt); b = M.lerp(b, 0.16, alt);
      // rocha em encostas e altitude
      const rock = Math.max(M.smoothstep(0.16, 0.38, slope), M.smoothstep(560, 950, h + n1 * 60));
      const rv = 0.42 + n1 * 0.12;
      r = M.lerp(r, rv, rock); g = M.lerp(g, rv * 0.96, rock); b = M.lerp(b, rv * 0.92, rock);
      // neve
      const snow = M.smoothstep(1000, 1280, h + n1 * 90) * (1 - M.smoothstep(0.42, 0.7, slope) * 0.75);
      r = M.lerp(r, 0.95, snow); g = M.lerp(g, 0.96, snow); b = M.lerp(b, 0.99, snow);
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  /* ===================================================================== Mundo */
  class World {
    constructor(scene, renderer) {
      this.scene = scene;
      this.renderer = renderer;
      this.chunks = new Map();
      this.pending = [];
      this.lastCenter = '';
      this.radius = 5;
      this.treeRadius = 1;
      this.time = 0;
      this.shadows = false;
      this.presetName = 'day';

      this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.treeGeom = treeGeometry();
      this.idx = this.buildIndex();

      this.buildLights();
      this.buildSky();
      this.buildWater();
      this.buildClouds();
      this.buildAirports();
      this.buildCities();
      this.buildRoads();
      this.setPreset('day');
    }

    buildIndex() {
      const N = SEG + 1;
      const idx = new Uint16Array(SEG * SEG * 6);
      let k = 0;
      for (let j = 0; j < SEG; j++) {
        for (let i = 0; i < SEG; i++) {
          const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
      }
      return new THREE.BufferAttribute(idx, 1);
    }

    /* ------------------------------------------------------------ luz, céu, água */
    buildLights() {
      this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6d6044, 0.6);
      this.sun = new THREE.DirectionalLight(0xffffff, 1);
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 1400;
      this.sun.shadow.bias = -0.0004;
      this.scene.add(this.hemi, this.sun, this.sun.target);
      this.sunDir = new THREE.Vector3(0.4, 0.6, 0.3).normalize();
    }

    buildSky() {
      const geo = new THREE.SphereGeometry(20000, 32, 20);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      this.skyGeo = geo;
      this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      this.sky.renderOrder = -10;
      this.sky.frustumCulled = false;
      this.scene.add(this.sky);

      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,250,220,0.95)');
      gr.addColorStop(0.3, 'rgba(255,220,150,0.25)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
      this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
      this.sunSprite.scale.set(3200, 3200, 1);
      this.sunSprite.renderOrder = -9;
      this.scene.add(this.sunSprite);
    }

    buildWater() {
      this.waterMat = new THREE.MeshPhongMaterial({ color: 0x2272a0, specular: 0x99bbdd, shininess: 90, transparent: true, opacity: 0.86 });
      const g = new THREE.PlaneGeometry(80000, 80000);
      g.rotateX(-Math.PI / 2);
      this.water = new THREE.Mesh(g, this.waterMat);
      this.water.position.y = 0;
      this.scene.add(this.water);
    }

    // ciclo contínuo: hora 0..24 -> mistura noite / entardecer / dia e posição do sol
    setTimeOfDay(h) {
      const th = ((h - 6) / 12) * Math.PI;
      const elev = Math.sin(th);
      const day = M.smoothstep(0.12, 0.45, elev);
      const night = 1 - M.smoothstep(-0.15, 0.05, elev);
      let p = mixPreset(PRESETS.dusk, PRESETS.day, day);
      p = mixPreset(p, PRESETS.night, night);
      const az = Math.cos(th);
      p.sun = elev > -0.05 ? [az * 0.9, Math.max(0.06, elev), 0.35] : PRESETS.night.sun;
      const key = Math.round(h * 20);
      if (key === this.todKey) return;
      this.todKey = key;
      this.night = night;
      this.applyPreset(p, 'tod');
    }

    setPreset(name) {
      this.todKey = null;
      this.night = name === 'night' ? 1 : 0;
      this.applyPreset(PRESETS[name] || PRESETS.day, name);
    }

    applyPreset(p, name) {
      this.preset = p;
      const pos = this.skyGeo.attributes.position, col = this.skyGeo.attributes.color;
      const sd = new THREE.Vector3(p.sun[0], p.sun[1], p.sun[2]).normalize();
      this.sunDir.copy(sd);
      for (let i = 0; i < pos.count; i++) {
        const d = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
        const t = Math.pow(M.clamp(d.y, 0, 1), 0.55);
        let r = M.lerp(p.horizon[0], p.zenith[0], t), g = M.lerp(p.horizon[1], p.zenith[1], t), b = M.lerp(p.horizon[2], p.zenith[2], t);
        if (d.y < 0) { const k = M.clamp(-d.y * 3, 0, 1) * 0.35; r *= 1 - k; g *= 1 - k; b *= 1 - k; }
        const glow = Math.pow(Math.max(0, d.dot(sd)), 24) * 0.8 + Math.pow(Math.max(0, d.dot(sd)), 4) * 0.12;
        col.setXYZ(i, Math.min(1, r + p.glow[0] * glow), Math.min(1, g + p.glow[1] * glow), Math.min(1, b + p.glow[2] * glow));
      }
      col.needsUpdate = true;
      this.fogColor = new THREE.Color(p.fog[0], p.fog[1], p.fog[2]);
      this.scene.background = this.fogColor;
      if (this.scene.fog) this.scene.fog.color.copy(this.fogColor);
      this.sun.color.setHex(p.sunColor); this.sun.intensity = p.sunI;
      this.hemi.color.setHex(p.hemiSky); this.hemi.groundColor.setHex(p.hemiGround); this.hemi.intensity = p.hemiI;
      this.waterMat.color.setHex(p.water);
      this.cloudMat.color.setHex(p.cloud);
      this.cloudMat.emissive.setHex(name === 'dusk' ? 0x3a1d12 : name === 'tod' ? new THREE.Color(0x2a2f38).multiplyScalar(1 - (this.night || 0) * 0.8).getHex() : 0x2a2f38);
      this.sunSprite.visible = !(this.night > 0.6);
    }

    setQuality(q) {
      this.radius = q.radius;
      this.treeRadius = q.treeRadius;
      this.setShadows(q.shadows);
      const far = this.radius * CS * 0.95;
      if (!this.scene.fog) this.scene.fog = new THREE.Fog(this.fogColor, far * 0.25, far);
      this.scene.fog.near = far * 0.25; this.scene.fog.far = far;
      this.scene.fog.color.copy(this.fogColor);
      this.lastCenter = '';
      // remove árvores fora do novo raio
      this.chunks.forEach((c) => { if (c.trees && c.ring > this.treeRadius) { this.removeTrees(c); } });
    }

    setShadows(on) {
      on = !!on;
      this.shadows = on;
      this.renderer.shadowMap.enabled = on;
      this.sun.castShadow = on;
      this.chunks.forEach((c) => { c.mesh.receiveShadow = on; });
      this.terrainMat.needsUpdate = true;
    }

    /* ------------------------------------------------------------------ nuvens */
    buildClouds() {
      this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.93 });
      const count = 1100;
      this.cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.cloudMat, count);
      this.cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.cloudMesh.frustumCulled = false;
      const rng = M.mulberry32(99);
      this.clouds = [];
      const L = 26000;
      this.cloudTile = L;
      while (this.clouds.length < count) {
        const bx = rng() * L, bz = rng() * L, by = 1700 + rng() * 1200;
        const n = 5 + Math.floor(rng() * 5), size = 140 + rng() * 220;
        for (let k = 0; k < n && this.clouds.length < count; k++) {
          this.clouds.push({
            x: bx + (rng() - 0.5) * size * 3.2, y: by + (rng() - 0.5) * size * 0.35, z: bz + (rng() - 0.5) * size * 2.2,
            sx: size * (0.7 + rng() * 0.7), sy: size * (0.35 + rng() * 0.2), sz: size * (0.7 + rng() * 0.7),
          });
        }
      }
      this.scene.add(this.cloudMesh);
      this.tmpM = new THREE.Matrix4(); this.tmpP = new THREE.Vector3(); this.tmpS = new THREE.Vector3(); this.tmpQ = new THREE.Quaternion();
    }

    updateClouds(cx, cz) {
      const L = this.cloudTile, m = this.tmpM, mesh = this.cloudMesh;
      for (let i = 0; i < this.clouds.length; i++) {
        const c = this.clouds[i];
        const x = c.x + L * Math.round((cx - c.x) / L);
        const z = c.z + L * Math.round((cz - c.z) / L);
        this.tmpP.set(x, c.y, z); this.tmpS.set(c.sx, c.sy, c.sz);
        m.compose(this.tmpP, this.tmpQ, this.tmpS);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    /* -------------------------------------------------------------------- blocos */
    chunkKey(cx, cz) { return cx + ',' + cz; }

    buildChunk(cx, cz) {
      const N = SEG + 1, P = SEG + 3, step = CS / SEG;
      const x0 = cx * CS, z0 = cz * CS;
      const hs = new Float32Array(P * P);
      for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) hs[j * P + i] = T.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
      const pos = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
      const c3 = [0, 0, 0];
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = (j * N + i) * 3;
          const hc = hs[(j + 1) * P + i + 1];
          const dx = hs[(j + 1) * P + i] - hs[(j + 1) * P + i + 2];
          const dz = hs[j * P + i + 1] - hs[(j + 2) * P + i + 1];
          const l = Math.hypot(dx, 2 * step, dz);
          nor[k] = dx / l; nor[k + 1] = (2 * step) / l; nor[k + 2] = dz / l;
          pos[k] = i * step; pos[k + 1] = hc; pos[k + 2] = j * step;
          terrainColor(hc, 1 - nor[k + 1], x0 + i * step, z0 + j * step, c3);
          col[k] = c3[0]; col[k + 1] = c3[1]; col[k + 2] = c3[2];
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(this.idx);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CS / 2, 500, CS / 2), CS * 1.1 + 900);
      const mesh = new THREE.Mesh(g, this.terrainMat);
      mesh.position.set(x0, 0, z0);
      mesh.receiveShadow = this.shadows;
      this.scene.add(mesh);
      const chunk = { cx, cz, mesh, trees: null, ring: 99 };
      this.chunks.set(this.chunkKey(cx, cz), chunk);
      return chunk;
    }

    buildTrees(chunk) {
      const cx = chunk.cx, cz = chunk.cz, x0 = cx * CS, z0 = cz * CS;
      const rng = M.mulberry32((cx * 73856093) ^ (cz * 19349663));
      const spots = [];
      const cell = 44;
      for (let j = 0; j < CS / cell; j++) {
        for (let i = 0; i < CS / cell; i++) {
          const x = x0 + (i + rng()) * cell, z = z0 + (j + rng()) * cell;
          const dens = T.forestDensity(x, z);
          if (dens < 0.5 || rng() > M.smoothstep(0.5, 0.64, dens) * 0.9) continue;
          if (T.isCleared(x, z)) continue;
          const h = T.heightAt(x, z);
          if (h < 4 || h > 650) continue;
          const hx = T.heightAt(x + 6, z) - h, hz = T.heightAt(x, z + 6) - h;
          if (Math.hypot(hx, hz) > 4.2) continue;
          spots.push(x, h, z, 0.8 + rng() * 0.9, rng());
        }
      }
      const count = spots.length / 5;
      if (!count) { chunk.trees = null; return; }
      const mesh = new THREE.InstancedMesh(this.treeGeom, this.treeMat, count);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const sc = spots[i * 5 + 3];
        p.set(spots[i * 5] - x0, spots[i * 5 + 1] - 0.3, spots[i * 5 + 2] - z0);
        q.setFromAxisAngle(THREE.Object3D.DefaultUp, spots[i * 5 + 4] * 6.28);
        s.set(sc, sc * (0.9 + spots[i * 5 + 4] * 0.5), sc);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        const v = 0.75 + spots[i * 5 + 4] * 0.5;
        mesh.setColorAt(i, c.setRGB(v, v * (0.95 + spots[i * 5 + 4] * 0.12), v * 0.9));
      }
      mesh.position.set(x0, 0, z0);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.scene.add(mesh);
      chunk.trees = mesh;
    }

    removeTrees(chunk) {
      if (!chunk.trees) return;
      this.scene.remove(chunk.trees);
      chunk.trees.dispose();
      chunk.trees = null;
    }

    removeChunk(key) {
      const c = this.chunks.get(key);
      if (!c) return;
      this.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      this.removeTrees(c);
      this.chunks.delete(key);
    }

    // Reavalia quais blocos devem existir ao redor de (x,z)
    refreshWanted(x, z) {
      const ccx = Math.floor(x / CS), ccz = Math.floor(z / CS);
      const key = ccx + ',' + ccz + ',' + this.radius + ',' + this.treeRadius;
      if (key === this.lastCenter) return;
      this.lastCenter = key;
      const R = this.radius, list = [];
      for (let dz = -R - 1; dz <= R + 1; dz++) {
        for (let dx = -R - 1; dx <= R + 1; dx++) {
          const d = Math.hypot(dx, dz);
          if (d <= R + 0.5) list.push({ cx: ccx + dx, cz: ccz + dz, d });
        }
      }
      list.sort((a, b) => a.d - b.d);
      const want = new Set(list.map((e) => this.chunkKey(e.cx, e.cz)));
      this.chunks.forEach((c, k) => { if (!want.has(k) && Math.hypot(c.cx - ccx, c.cz - ccz) > R + 1.6) this.removeChunk(k); });
      this.pending = list.filter((e) => !this.chunks.has(this.chunkKey(e.cx, e.cz)));
      this.center = [ccx, ccz];
      // anéis de árvores
      this.chunks.forEach((c) => {
        c.ring = Math.hypot(c.cx - ccx, c.cz - ccz);
        if (c.trees && c.ring > this.treeRadius + 0.6) this.removeTrees(c);
      });
      this.treeQueue = [];
      this.chunks.forEach((c) => { if (!c.trees && !c.treesTried && c.ring <= this.treeRadius + 0.5) this.treeQueue.push(c); });
    }

    // orçamento de trabalho por quadro
    streamStep(x, z, budget) {
      this.refreshWanted(x, z);
      let n = 0;
      while (this.pending.length && n < budget) {
        const e = this.pending.shift();
        if (!this.chunks.has(this.chunkKey(e.cx, e.cz))) {
          const c = this.buildChunk(e.cx, e.cz);
          c.ring = Math.hypot(e.cx - this.center[0], e.cz - this.center[1]);
          if (c.ring <= this.treeRadius + 0.5) { this.buildTrees(c); c.treesTried = true; }
          n++;
        }
      }
      while (n < budget && this.treeQueue && this.treeQueue.length) {
        const c = this.treeQueue.shift();
        if (this.chunks.get(this.chunkKey(c.cx, c.cz)) === c && !c.trees) { this.buildTrees(c); c.treesTried = true; n++; }
      }
      // permite reconstruir árvores quando o chunk volta ao anel
      this.chunks.forEach((c) => { if (c.treesTried && !c.trees && c.ring > this.treeRadius + 1.2) c.treesTried = false; });
    }

    async preload(x, z, onProgress) {
      this.lastCenter = '';
      this.refreshWanted(x, z);
      const total = this.pending.length + this.chunks.size;
      let done = this.chunks.size;
      while (this.pending.length) {
        this.streamStep(x, z, 3);
        done = total - this.pending.length;
        if (onProgress) onProgress(done / total);
        await new Promise((r) => setTimeout(r, 0));
      }
      this.refreshWanted(x, z);
      let guard = 0;
      while (this.treeQueue && this.treeQueue.length && guard++ < 400) {
        this.streamStep(x, z, 3);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (onProgress) onProgress(1);
    }

    /* --------------------------------------------------------------- por quadro */
    update(playerPos, camPos, dt, shadowFocus) {
      this.time += dt;
      this.streamStep(playerPos[0], playerPos[2], 1);
      // céu / sol / água acompanham a câmera
      this.sky.position.copy(camPos);
      this.sunSprite.position.copy(camPos).addScaledVector(this.sunDir, 15000);
      const snap = 800;
      this.water.position.x = Math.round(camPos.x / snap) * snap;
      this.water.position.z = Math.round(camPos.z / snap) * snap;
      const f = shadowFocus || camPos;
      this.sun.position.copy(f).addScaledVector(this.sunDir, 700);
      this.sun.target.position.copy(f);
      this.sun.target.updateMatrixWorld();
      this.updateClouds(camPos.x, camPos.z);
      // aeroportos distantes ficam ocultos
      for (const a of this.airportGroups) {
        const d = Math.hypot(a.ap.x - playerPos[0], a.ap.z - playerPos[2]);
        a.group.visible = d < this.radius * CS * 1.15;
        a.beam.visible = d < 30000;
        a.beam.material.opacity = 0.10 + 0.05 * Math.sin(this.time * 2 + a.ap.x);
        a.beacon.material.opacity = 0.5 + 0.5 * Math.max(0, Math.sin(this.time * 3));
      }
    }

    /* --------------------------------------------------------------- aeroportos */
    runwayTexture(ap) {
      const W = ap.width, Lr = ap.length;
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 4096;
      const c = cv.getContext('2d');
      const pxX = 256 / W, pxY = 4096 / Lr;
      c.setTransform(pxX, 0, 0, pxY, 0, 0);   // desenho em metros: x = largura, y = comprimento (0 = ponta à frente)
      c.fillStyle = '#2b2d32'; c.fillRect(0, 0, W, Lr);
      const rng = M.mulberry32(5);
      for (let i = 0; i < 500; i++) {
        c.fillStyle = `rgba(${rng() > 0.5 ? 255 : 0},${rng() > 0.5 ? 255 : 0},${rng() > 0.5 ? 255 : 0},0.03)`;
        c.fillRect(rng() * W, rng() * Lr, 1 + rng() * 6, 8 + rng() * 60);
      }
      // faixas de rodagem escurecidas
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(W * 0.28, 0, 3, Lr); c.fillRect(W * 0.72 - 3, 0, 3, Lr);
      c.fillStyle = '#e8e8e2';
      c.fillRect(0.9, 0, 0.45, Lr); c.fillRect(W - 1.35, 0, 0.45, Lr);                // bordas
      for (let y = 60; y < Lr - 60; y += 50) c.fillRect(W / 2 - 0.45, y, 0.9, 30);    // eixo tracejado
      const bars = (yStart, dir) => {
        for (let i = 0; i < 8; i++) c.fillRect(2.4 + i * ((W - 4.8) / 8) + 0.2, dir > 0 ? yStart : yStart - 30, 1.6, 30);
        for (const off of [150, 300, 450, 600]) {
          const ww = off === 300 ? 7 : 4.5;
          const y = dir > 0 ? yStart + off : yStart - off - 24;
          c.fillRect(W / 2 - 9 - ww, y, ww, 22); c.fillRect(W / 2 + 9, y, ww, 22);
          if (off === 150 || off === 450) { c.fillRect(W / 2 - 15 - ww, y, ww - 1, 22); c.fillRect(W / 2 + 15, y, ww - 1, 22); }
        }
      };
      bars(14, 1);          // ponta "à frente"
      bars(Lr - 14, -1);    // ponta de trás
      const num = (text, y, flip) => {
        c.save();
        c.translate(W / 2, y);
        if (flip) c.rotate(Math.PI);
        c.scale(1, 1);
        c.fillStyle = '#f2f2ec';
        c.font = 'bold 20px "Arial Narrow", Arial, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(text, 0, 0);
        c.restore();
      };
      // texto lido de baixo para cima: a ponta de trás (y grande) mostra o número do rumo
      num(ap.runwayNumber, Lr - 62, false);
      num(ap.reciprocalNumber, 62, true);
      const tex = new THREE.CanvasTexture(cv);
      tex.anisotropy = 8;
      return tex;
    }

    buildAirports() {
      this.airportGroups = [];
      const po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
      const asphalt = new THREE.MeshLambertMaterial(Object.assign({ color: 0x3a3c41 }, po));
      const apronMat = new THREE.MeshLambertMaterial(Object.assign({ color: 0x4b4d52 }, po));
      const lineMat = new THREE.MeshBasicMaterial(Object.assign({ color: 0xe6c935 }, po, { polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      const lightGeo = new THREE.BoxGeometry(0.6, 0.35, 0.6);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const hangarMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x4f6a86 });
      const termMat = new THREE.MeshLambertMaterial({ color: 0xcfd3d8 });
      const glassMat = new THREE.MeshLambertMaterial({ color: 0x3a6a8a, emissive: 0x112233 });
      const towerMat = new THREE.MeshLambertMaterial({ color: 0xe9e9e4 });

      T.AIRPORTS.forEach((ap) => {
        const g = new THREE.Group();
        g.position.set(ap.x, ap.elev, ap.z);
        g.rotation.y = -ap.heading * M.DEG;
        const flat = (u0, u1, w0, w1, mat, y) => {
          const geo = new THREE.PlaneGeometry(w1 - w0, u1 - u0);
          geo.rotateX(-Math.PI / 2);
          const m = new THREE.Mesh(geo, mat);
          m.position.set((w0 + w1) / 2, y, -(u0 + u1) / 2);
          g.add(m);
          return m;
        };
        // pista com marcações
        const rtex = this.runwayTexture(ap);
        const rw = new THREE.Mesh(new THREE.PlaneGeometry(ap.width, ap.length).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial(Object.assign({ map: rtex }, po, { polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
        rw.position.set(0, 0.10, 0);
        g.add(rw);
        // táxi e pátio
        ap.taxiRects.forEach((r) => {
          flat(r[0], r[1], r[2], r[3], asphalt, 0.08);
          if (r[1] - r[0] > r[3] - r[2]) flat(r[0], r[1], (r[2] + r[3]) / 2 - 0.25, (r[2] + r[3]) / 2 + 0.25, lineMat, 0.1);
          else flat((r[0] + r[1]) / 2 - 0.25, (r[0] + r[1]) / 2 + 0.25, r[2], r[3], lineMat, 0.1);
        });
        flat(ap.apronRect[0], ap.apronRect[1], ap.apronRect[2], ap.apronRect[3], apronMat, 0.07);
        // vagas de estacionamento (linhas)
        for (let i = -3; i <= 3; i++) flat(i * 110 - 0.3, i * 110 + 0.3, 170, 330, lineMat, 0.09);
        // estruturas
        ap.structures.forEach((s) => {
          if (s.kind === 'hangar') {
            const b = new THREE.Mesh(new THREE.BoxGeometry(s.hw * 2, s.h * 0.82, s.hu * 2), hangarMat);
            b.position.set(s.w, s.h * 0.41, -s.u);
            const roofGeo = new THREE.CylinderGeometry(1, 1, s.hu * 2, 16);
            roofGeo.rotateX(Math.PI / 2);
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.scale.set(s.hw, s.h * 0.2, 1);
            roof.position.set(s.w, s.h * 0.82, -s.u);
            const door = new THREE.Mesh(new THREE.PlaneGeometry(s.hw * 1.6, s.h * 0.6), new THREE.MeshLambertMaterial({ color: 0x30353b }));
            door.position.set(s.w - s.hw - 0.05, s.h * 0.32, -s.u); door.rotation.y = -Math.PI / 2;
            g.add(b, roof, door);
          } else if (s.kind === 'terminal') {
            const b = new THREE.Mesh(new THREE.BoxGeometry(s.hw * 2, s.h, s.hu * 2), termMat);
            b.position.set(s.w, s.h / 2, -s.u);
            const gl = new THREE.Mesh(new THREE.BoxGeometry(0.4, s.h * 0.4, s.hu * 1.8), glassMat);
            gl.position.set(s.w - s.hw - 0.1, s.h * 0.55, -s.u);
            g.add(b, gl);
          } else if (s.kind === 'tower') {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, s.h - 7, 10), towerMat);
            shaft.position.set(s.w, (s.h - 7) / 2, -s.u);
            const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 4.2, 6, 10), glassMat);
            cab.position.set(s.w, s.h - 4, -s.u);
            const top = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.8, 10), towerMat);
            top.position.set(s.w, s.h - 0.6, -s.u);
            g.add(shaft, cab, top);
            ap._beaconPos = [s.w, s.h + 1.5, -s.u];
          }
        });
        // luzes da pista, cabeceiras e rampa de aproximação
        const lights = [];
        const L = ap.length / 2;
        for (let u = -L; u <= L; u += 60) { lights.push([-ap.width / 2 - 1.5, u, 0xffffee], [ap.width / 2 + 1.5, u, 0xffffee]); }
        for (let i = -5; i <= 5; i++) { lights.push([i * 4.5, -L - 1.5, 0x33ff66], [i * 4.5, L + 1.5, 0xff3322]); }
        for (let d = 30; d <= 600; d += 30) lights.push([0, -L - d, 0xfff3cf], [0, L + d, 0xfff3cf]);
        const lm = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
        const mm = new THREE.Matrix4(), cc = new THREE.Color();
        lights.forEach((l, i) => {
          mm.makeTranslation(l[0], 0.35, -l[1]);
          lm.setMatrixAt(i, mm); lm.setColorAt(i, cc.setHex(l[2]));
        });
        lm.frustumCulled = false;
        g.add(lm);
        // farol rotativo e coluna de luz de navegação
        const bp = ap._beaconPos || [0, 40, 0];
        const bc = document.createElement('canvas'); bc.width = bc.height = 64;
        const bx = bc.getContext('2d'); const bg = bx.createRadialGradient(32, 32, 0, 32, 32, 32);
        bg.addColorStop(0, 'rgba(255,255,255,1)'); bg.addColorStop(0.3, 'rgba(120,255,160,0.7)'); bg.addColorStop(1, 'rgba(0,255,120,0)');
        bx.fillStyle = bg; bx.fillRect(0, 0, 64, 64);
        const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        beacon.scale.set(40, 40, 1); beacon.position.set(bp[0], bp[1] + 3, bp[2]);
        g.add(beacon);
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(5, 14, 700, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide })
        );
        beam.position.set(bp[0], bp[1] + 350, bp[2]);
        g.add(beam);
        this.scene.add(g);
        this.airportGroups.push({ ap, group: g, beam, beacon });
      });
    }

    /* ------------------------------------------------------------------ cidades */
    buildCities() {
      const boxGeo = boxGeometryColored(1.0, 0.86);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const rng = M.mulberry32(21);
      const palette = [0xb9bfc7, 0x9aa3ad, 0xd4c9b4, 0x8d98a8, 0xc7b8a4, 0xa8b4bf, 0xe0ddd5, 0x7d8896];
      const roadMat = new THREE.MeshBasicMaterial({ color: 0x2e3035, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      T.CITY_DEFS.forEach((city, ci) => {
        const list = T.cityBuildings[ci];
        const mesh = new THREE.InstancedMesh(boxGeo, mat, list.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
        list.forEach((b, i) => {
          p.set(b.cx, b.y0, b.cz); s.set(b.hu * 2, b.y1 - b.y0, b.hw * 2);
          m.compose(p, q, s);
          mesh.setMatrixAt(i, m);
          c.setHex(palette[Math.floor(rng() * palette.length)]);
          const tall = M.clamp((b.y1 - b.y0) / 120, 0, 1);
          c.lerp(new THREE.Color(0x5f84a6), tall * 0.5);
          mesh.setColorAt(i, c);
        });
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        // ruas
        const step = 110, n = Math.ceil(city.r / step);
        const streets = [];
        for (let i = -n; i <= n + 1; i++) {
          const off = i * step - step / 2;
          const half = Math.sqrt(Math.max(0, city.r * city.r - off * off));
          if (half > 20) { streets.push([city.x + off, city.z, 18, half * 2, 0]); streets.push([city.x, city.z + off, half * 2, 18, 0]); }
        }
        const sg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const sm = new THREE.InstancedMesh(sg, roadMat, streets.length);
        streets.forEach((st, i) => {
          p.set(st[0], T.CITY_ELEV[ci] + 0.15, st[1]); s.set(st[2], 1, st[3]);
          m.compose(p, q, s); sm.setMatrixAt(i, m);
        });
        sm.frustumCulled = false;
        this.scene.add(sm);
      });
    }

    /* ------------------------------------------------------------------ estradas */
    buildRoads() {
      const mat = new THREE.MeshBasicMaterial({ color: 0x35373c });
      T.ROADS.forEach((road) => {
        const pts = road.points, n = pts.length;
        const pos = new Float32Array(n * 2 * 3), idx = [];
        for (let i = 0; i < n; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
          let dx = b[0] - a[0], dz = b[1] - a[1];
          const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const nx = -dz * road.width / 2, nz = dx * road.width / 2;
          const h = Math.max(T.heightAt(pts[i][0], pts[i][1]), 1.2) + 0.7;
          pos.set([pts[i][0] + nx, h, pts[i][1] + nz, pts[i][0] - nx, h, pts[i][1] - nz], i * 6);
          if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat);
        m.material.side = THREE.DoubleSide;
        this.scene.add(m);
      });
    }
  }

  FS.World = World;
  FS.CHUNK_SIZE = CS;
})(typeof window !== 'undefined' ? window : globalThis);
