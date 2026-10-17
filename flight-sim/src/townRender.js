/* townRender.js — malhas 3D da Vila Esperança a partir dos dados de town.js.
 * Paredes e lajes de cada andar são fundidas numa única malha (poucas chamadas de desenho);
 * andares acima do jogador ficam ocultos quando ele está dentro de um prédio. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const TW = FS.Town;

  function boxGeom(x0, x1, y0, y1, z0, z1, color) {
    const g = new THREE.BoxGeometry(Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0), Math.max(0.01, z1 - z0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const n = g.attributes.normal, c = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
      const shade = n.getY(i) > 0.5 ? 1.0 : n.getY(i) < -0.5 ? 0.7 : 0.88;
      c[i * 3] = color[0] * shade; c[i * 3 + 1] = color[1] * shade; c[i * 3 + 2] = color[2] * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  function merge(list) {
    let vc = 0, ic = 0;
    list.forEach((g) => { vc += g.attributes.position.count; ic += g.index.count; });
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3);
    const idx = vc > 65000 ? new Uint32Array(ic) : new Uint16Array(ic);
    let vo = 0, io = 0;
    list.forEach((g) => {
      pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); col.set(g.attributes.color.array, vo * 3);
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      vo += g.attributes.position.count; io += g.index.count;
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }

  class TownRender {
    constructor(scene) {
      this.scene = scene;
      this.root = new THREE.Group();
      scene.add(this.root);
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.floors = {};          // bid -> [mesh por andar]
      this.doorMeshes = new Map();
      this.build();
    }

    build() {
      const byFloor = {};
      TW.walls.forEach((w) => {
        if (w.kind === 'container' || w.kind === 'prop' || w.noCollide || !w.bid) return;
        const k = w.bid + '|' + w.floor;
        (byFloor[k] = byFloor[k] || []).push(boxGeom(w.x0, w.x1, w.y0, w.y1, w.z0, w.z1, w.color || [0.8, 0.8, 0.8]));
      });
      TW.buildings.forEach((b) => {
        b.parts.forEach((p) => {
          const k = b.id + '|' + p.floor;
          if (p.kind === 'slab' || p.kind === 'roof') (byFloor[k] = byFloor[k] || []).push(boxGeom(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, p.color));
          if (p.kind === 'ramp') {
            const r = p.ramp, n = 14;
            for (let i = 0; i < n; i++) {
              const t0 = i / n, t1 = (i + 1) / n;
              const za = M.lerp(r.za, r.zb, t0), zb = M.lerp(r.za, r.zb, t1);
              const y = M.lerp(r.ya, r.yb, t1);
              (byFloor[k] = byFloor[k] || []).push(boxGeom(r.x0, r.x1, M.lerp(r.ya, r.yb, t0) - 0.2, y, Math.min(za, zb), Math.max(za, zb), [0.5, 0.47, 0.44]));
            }
          }
        });
      });
      for (const k in byFloor) {
        const [bid, f] = k.split('|');
        const mesh = new THREE.Mesh(merge(byFloor[k]), this.mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.root.add(mesh);
        (this.floors[bid] = this.floors[bid] || [])[+f] = mesh;
      }
      // vidros das janelas (uma malha por prédio)
      const glassMat = new THREE.MeshLambertMaterial({ color: 0x6f8fa8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
      const glassBy = {};
      TW.windows.forEach((w) => {
        if (w.broken) return;
        const g = w.alongWorldX ? new THREE.PlaneGeometry(w.width, w.y1 - w.y0) : new THREE.PlaneGeometry(w.width, w.y1 - w.y0).rotateY(Math.PI / 2);
        g.translate(w.x, (w.y0 + w.y1) / 2, w.z);
        const k = w.bid + '|' + w.floor;
        (glassBy[k] = glassBy[k] || []).push(g);
      });
      this.glass = {};
      for (const k in glassBy) {
        const list = glassBy[k];
        let vc = 0; list.forEach((g) => { vc += g.attributes.position.count; });
        const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), idx = [];
        let vo = 0;
        list.forEach((g) => { pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + vo); vo += g.attributes.position.count; });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setIndex(idx);
        const mesh = new THREE.Mesh(geo, glassMat);
        mesh.renderOrder = 2;
        this.root.add(mesh);
        const [bid, f] = k.split('|');
        (this.glass[bid] = this.glass[bid] || [])[+f] = mesh;
      }
      // portas (malhas individuais com dobradiça)
      const doorMat = new THREE.MeshLambertMaterial({ color: 0x6a4a30 });
      const lockedMat = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
      TW.doors.forEach((d) => {
        const alongX = d.alongWorldX;
        const len = alongX ? d.x1 - d.x0 : d.z1 - d.z0;
        const g = new THREE.BoxGeometry(alongX ? len : 0.08, d.y1 - d.y0, alongX ? 0.08 : len);
        g.translate(alongX ? len / 2 : 0, (d.y1 - d.y0) / 2, alongX ? 0 : len / 2);
        const pivot = new THREE.Group();
        pivot.position.set(d.x0 + (alongX ? 0 : 0.04), d.y0, d.z0 + (alongX ? (d.z1 - d.z0) / 2 : 0));
        const mesh = new THREE.Mesh(g, d.locked ? lockedMat : doorMat);
        mesh.castShadow = true;
        pivot.add(mesh);
        this.root.add(pivot);
        pivot.userData = { door: d, angle: 0 };
        this.doorMeshes.set(d, pivot);
      });
      // móveis com saque (instanciados)
      const cg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      this.contMesh = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ color: 0xffffff }), TW.containers.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
      TW.containers.forEach((ct, i) => {
        p.set(ct.x, ct.y0, ct.z); s.set(ct.x1 - ct.x0, ct.y1 - ct.y0, ct.z1 - ct.z0);
        m4.compose(p, q, s); this.contMesh.setMatrixAt(i, m4);
        this.contMesh.setColorAt(i, c.setRGB(ct.color[0], ct.color[1], ct.color[2]));
        ct.instance = i;
      });
      this.contMesh.castShadow = true;
      this.contMesh.frustumCulled = false;
      this.root.add(this.contMesh);
      this.buildStreets();
      this.buildProps();
    }

    markContainer(ct) {
      if (ct.instance === undefined) return;
      const c = new THREE.Color(ct.color[0] * 0.55, ct.color[1] * 0.55, ct.color[2] * 0.55);
      this.contMesh.setColorAt(ct.instance, c);
      this.contMesh.instanceColor.needsUpdate = true;
    }

    buildStreets() {
      const asphalt = new THREE.MeshLambertMaterial({ color: 0x34363a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const line = new THREE.MeshBasicMaterial({ color: 0xd8d0a0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const sidewalk = new THREE.MeshLambertMaterial({ color: 0x8a8780, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const y = TW.ELEV + 0.04;
      TW.streets.forEach((st) => {
        const w = st.x1 - st.x0, d = st.z1 - st.z0;
        const sw = new THREE.Mesh(new THREE.PlaneGeometry(w + 3, d + 3).rotateX(-Math.PI / 2), sidewalk);
        sw.position.set((st.x0 + st.x1) / 2, y - 0.01, (st.z0 + st.z1) / 2); this.root.add(sw);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), asphalt);
        m.position.set((st.x0 + st.x1) / 2, y, (st.z0 + st.z1) / 2); m.receiveShadow = true; this.root.add(m);
        if (st.main) {
          const alongX = w > d;
          for (let t = 2; t < (alongX ? w : d) - 2; t += 6) {
            const l = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? 3 : 0.2, alongX ? 0.2 : 3).rotateX(-Math.PI / 2), line);
            l.position.set(alongX ? st.x0 + t : (st.x0 + st.x1) / 2, y + 0.01, alongX ? (st.z0 + st.z1) / 2 : st.z0 + t);
            this.root.add(l);
          }
        }
      });
    }

    buildProps() {
      const L = (hex) => new THREE.MeshLambertMaterial({ color: hex });
      const add = (g, m, x, y, z, ry) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); if (ry) o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; this.root.add(o); return o; };
      const E = TW.ELEV;
      this.lampHeads = [];
      TW.props.forEach((p) => {
        const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, w = p.x1 - p.x0, d = p.z1 - p.z0;
        if (p.type === 'wreck') {
          const col = p.burnt ? 0x2a2522 : new THREE.Color(p.color[0], p.color[1], p.color[2]).getHex();
          add(new THREE.BoxGeometry(w, 0.75, d), L(col), cx, E + 0.6, cz);
          add(new THREE.BoxGeometry(p.alongX ? w * 0.5 : w * 0.9, 0.55, p.alongX ? d * 0.9 : d * 0.5), L(p.burnt ? 0x1a1a1a : 0x2a3540), cx, E + 1.25, cz);
          const wg = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 10).rotateZ(Math.PI / 2);
          const wm = L(0x111111);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const o = add(wg, wm, cx + (p.alongX ? sx * w * 0.32 : sx * w * 0.5), E + 0.34, cz + (p.alongX ? sz * d * 0.5 : sz * d * 0.32));
            if (!p.alongX) o.rotation.y = Math.PI / 2;
          }
        } else if (p.type === 'canopy') {
          add(new THREE.BoxGeometry(w, 0.5, d), L(0xd23a2a), cx, E + p.h, cz);
        } else if (p.type === 'pillar' || p.type === 'lamp') {
          add(new THREE.BoxGeometry(w, p.h, d), L(p.type === 'lamp' ? 0x404448 : 0xe0e0e0), cx, E + p.h / 2, cz);
          if (p.type === 'lamp') {
            const head = add(new THREE.BoxGeometry(0.6, 0.2, 0.35), new THREE.MeshLambertMaterial({ color: 0x777777, emissive: 0x000000 }), cx, E + p.h, cz + 0.3);
            this.lampHeads.push(head);
          }
        } else if (p.type === 'pump') {
          add(new THREE.BoxGeometry(w, p.h, d), L(0xeeeeee), cx, E + p.h / 2, cz);
          add(new THREE.BoxGeometry(w * 1.05, 0.3, d * 1.05), L(0xd23a2a), cx, E + p.h - 0.2, cz);
        } else if (p.type === 'fence' || p.type === 'barricade') {
          add(new THREE.BoxGeometry(w, p.h, d), L(p.type === 'fence' ? 0x7a6a50 : 0x5a4a3a), cx, E + p.h / 2, cz);
        } else if (p.type === 'tent') {
          const g = new THREE.ConeGeometry(Math.min(w, d) * 0.62, p.h, 4);
          const o = add(g, L(new THREE.Color(p.color[0], p.color[1], p.color[2]).getHex()), cx, E + p.h / 2, cz, Math.PI / 4);
          o.scale.set(w / Math.min(w, d), 1, d / Math.min(w, d));
        } else if (p.type === 'generator') {
          add(new THREE.BoxGeometry(w, p.h, d), L(0x3a6a3a), cx, E + p.h / 2, cz);
        } else if (p.type === 'field') {
          add(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a4028, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), cx, E + 0.05, cz);
          const rowMat = L(0x4a8a3a);
          for (let i = 0; i < 8; i++) add(new THREE.BoxGeometry(w - 2, 0.35, 0.6), rowMat, cx, E + 0.2, p.z0 + 1.5 + i * (d - 3) / 7);
        }
      });
      // placas com nome dos prédios
      TW.buildings.forEach((b) => {
        if (!b.entrance) return;
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
        const c = cv.getContext('2d');
        c.fillStyle = '#1d2328'; c.fillRect(0, 0, 512, 96);
        c.fillStyle = '#f2efe6'; c.font = 'bold 44px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(b.name.toUpperCase().slice(0, 22), 256, 50);
        const tex = new THREE.CanvasTexture(cv);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.85), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        const out = b.front === 'S' ? 1 : -1;
        sign.position.set(b.entrance.x, b.floorY(0) + 2.75, out > 0 ? b.z1 + 0.06 : b.z0 - 0.06);
        this.root.add(sign);
      });
    }

    // portas animadas, andares ocultos e luzes noturnas
    update(dt, player, night) {
      this.doorMeshes.forEach((pv, d) => {
        const target = d.open ? (d.broken ? 1.75 : 1.5) : 0;
        pv.userData.angle += (target - pv.userData.angle) * Math.min(1, dt * 6);
        pv.rotation.y = d.alongWorldX ? -pv.userData.angle : pv.userData.angle;
      });
      const b = player && TW.buildingAt(player.x, player.z);
      const fl = b ? TW.floorOf(b, player.y + 0.3) : -1;
      for (const bid in this.floors) {
        const arr = this.floors[bid];
        const inside = b && b.id === bid && player.y < b.topY - 0.5;
        arr.forEach((m, k) => { if (m) m.visible = !inside || k <= fl; });
        const gl = this.glass[bid];
        if (gl) gl.forEach((m, k) => { if (m) m.visible = !inside || k <= fl; });
      }
      this.doorMeshes.forEach((pv, d) => { pv.visible = !(b && d.bid === b.id && player.y < b.topY - 0.5 && d.floor > fl); });
      const lit = night > 0.5;
      if (lit !== this.lampsLit) {
        this.lampsLit = lit;
        this.lampHeads.forEach((h) => { h.material.emissive.setHex(lit ? 0xffe0a0 : 0x000000); });
      }
    }
  }

  FS.TownRender = TownRender;
})(typeof window !== 'undefined' ? window : globalThis);
