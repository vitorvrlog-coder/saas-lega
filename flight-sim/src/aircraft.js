/* aircraft.js — modelo 3D do caça (nariz em -Z, CG na origem) e cockpit.
 * As superfícies de controle, o trem de pouso, os flaps e o pós-combustor
 * são animados a partir do estado real da simulação (FlightModel). */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;

  /* Prisma a partir de um polígono 2D convexo: map(a, b, s) -> [x, y, z] */
  function prism(points, thickness, map) {
    const tris = [];
    const n = points.length;
    const h = thickness / 2;
    const v = (i, s) => map(points[i][0], points[i][1], s * h);
    for (let i = 1; i < n - 1; i++) {
      tris.push(v(0, 1), v(i, 1), v(i + 1, 1));
      tris.push(v(0, -1), v(i + 1, -1), v(i, -1));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tris.push(v(i, 1), v(i, -1), v(j, 1));
      tris.push(v(j, 1), v(i, -1), v(j, -1));
    }
    const pos = new Float32Array(tris.length * 3);
    tris.forEach((p, i) => pos.set(p, i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  class Aircraft {
    constructor() {
      this.root = new THREE.Group();
      this.model = new THREE.Group();
      this.root.add(this.model);
      this.mats = {
        body: new THREE.MeshPhongMaterial({ color: 0x78818d, shininess: 40, specular: 0x333a44 }),
        wing: new THREE.MeshPhongMaterial({ color: 0x8b939e, shininess: 30, side: THREE.DoubleSide }),
        tail: new THREE.MeshPhongMaterial({ color: 0x6a7380, shininess: 30, side: THREE.DoubleSide }),
        dark: new THREE.MeshPhongMaterial({ color: 0x22252b, shininess: 10 }),
        metal: new THREE.MeshPhongMaterial({ color: 0x5b5f66, shininess: 80, specular: 0x777777 }),
        glass: new THREE.MeshPhongMaterial({ color: 0x78b7ff, transparent: true, opacity: 0.42, shininess: 120, specular: 0xffffff }),
        tyre: new THREE.MeshLambertMaterial({ color: 0x15161a }),
        accent: new THREE.MeshLambertMaterial({ color: 0xd8a416, side: THREE.DoubleSide }),
        red: new THREE.MeshBasicMaterial({ color: 0xff2222 }),
        green: new THREE.MeshBasicMaterial({ color: 0x22ff55 }),
        white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      };
      this.build();
    }

    add(parent, mesh, x = 0, y = 0, z = 0) {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    }

    build() {
      const m = this.mats, g = this.model;
      // fuselagem (revolução)
      const prof = [[0.0, -7.6], [0.42, -7.5], [0.72, -6.4], [0.96, -4.5], [1.06, -2.0], [1.06, 1.0], [0.98, 2.8], [0.80, 4.5], [0.52, 6.0], [0.2, 7.2], [0.0, 7.75]]
        .map((p) => new THREE.Vector2(p[0], p[1]));
      const fgeo = new THREE.LatheGeometry(prof, 20);
      fgeo.rotateX(-Math.PI / 2);
      const fus = new THREE.Mesh(fgeo, m.body);
      fus.scale.set(1.12, 0.86, 1);
      this.add(g, fus);
      // radome escuro
      const radome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), m.dark);
      radome.scale.set(0.9, 0.7, 2.2);
      this.add(g, radome, 0, -0.02, -6.7);
      // dorso
      this.add(g, new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 4.6), m.body), 0, 0.9, 2.4);
      // entradas de ar
      for (const s of [-1, 1]) {
        this.add(g, new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.9, 3.4), m.body), s * 1.3, -0.3, -1.4);
        this.add(g, new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 0.1), m.dark), s * 1.3, -0.3, -3.12);
        // motores/bocais
        this.add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 3.6, 14).rotateX(Math.PI / 2), m.body), s * 0.7, -0.05, 5.6);
        this.add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 1.0, 14, 1, true).rotateX(Math.PI / 2), m.metal), s * 0.7, -0.05, 7.8);
      }
      // cabine
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), m.glass);
      canopy.scale.set(0.52, 0.5, 1.9);
      this.add(g, canopy, 0, 0.62, -3.5);
      this.canopy = canopy;
      this.add(g, new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 2.6), m.dark), 0, 0.5, -3.4);
      // asas
      this.flaps = []; this.ailerons = [];
      for (const s of [-1, 1]) {
        const wpts = [[0.9, -0.8], [5.5, 2.2], [5.5, 3.05], [0.9, 3.05]];
        const wing = new THREE.Mesh(prism(wpts, 0.2, (a, b, t) => [s * a, t, b]), m.wing);
        this.add(g, wing);
        // flap
        const flap = new THREE.Group();
        flap.position.set(s * 2.15, 0, 3.05);
        flap.add(this.part(new THREE.BoxGeometry(2.1, 0.1, 0.85).translate(0, 0, 0.425), m.wing));
        g.add(flap); this.flaps.push(flap);
        // aileron
        const ail = new THREE.Group();
        ail.position.set(s * 4.4, 0, 3.05);
        ail.add(this.part(new THREE.BoxGeometry(2.1, 0.09, 0.72).translate(0, 0, 0.36), m.accent));
        g.add(ail); this.ailerons.push(ail);
        // luzes de navegação
        const nav = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), s < 0 ? m.red : m.green);
        nav.position.set(s * 5.5, 0, 2.7);
        g.add(nav);
        // mísseis/tanque: pontas de asa
        this.add(g, new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8).rotateX(Math.PI / 2), m.body), s * 5.65, -0.05, 1.3);
      }
      // estabilizadores horizontais (todo móveis)
      this.stabs = [];
      for (const s of [-1, 1]) {
        const stab = new THREE.Group();
        stab.position.set(s * 1.0, -0.05, 6.2);
        const pts = [[0, -1.2], [2.9, 0.1], [2.9, 1.1], [0, 1.1]];
        stab.add(this.part(prism(pts, 0.14, (a, b, t) => [s * a, t, b]), m.tail));
        g.add(stab); this.stabs.push(stab);
      }
      // deriva dupla inclinada + lemes
      this.rudders = [];
      for (const s of [-1, 1]) {
        const fin = new THREE.Group();
        fin.position.set(s * 1.1, 0.55, 0);
        fin.rotation.z = -s * 0.32;
        fin.add(this.part(prism([[3.4, 0], [5.5, 3.2], [6.1, 3.2], [6.1, 0]], 0.12, (a, b, t) => [t, b, a]), m.tail));
        const rud = new THREE.Group();
        rud.position.set(0, 0, 6.1);
        rud.add(this.part(new THREE.BoxGeometry(0.1, 3.2, 0.85).translate(0, 1.6, 0.425), m.accent));
        fin.add(rud); this.rudders.push(rud);
        g.add(fin);
      }
      // trem de pouso
      this.gears = [];
      const defs = FS.AC.gear;
      defs.forEach((d, i) => {
        const gear = new THREE.Group();
        gear.position.set(d.p[0], d.p[1], d.p[2]);
        const steer = new THREE.Group();
        gear.add(steer);
        steer.add(this.part(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8).translate(0, -0.3, 0), m.metal));
        const lower = new THREE.Group();
        lower.add(this.part(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8).translate(0, -0.65, 0), m.metal));
        const wheel = new THREE.Group();
        wheel.position.y = -0.9;
        wheel.add(this.part(new THREE.CylinderGeometry(0.35, 0.35, i === 0 ? 0.2 : 0.3, 14).rotateZ(Math.PI / 2), m.tyre));
        wheel.add(this.part(new THREE.CylinderGeometry(0.2, 0.2, i === 0 ? 0.22 : 0.32, 10).rotateZ(Math.PI / 2), m.metal));
        lower.add(wheel);
        steer.add(lower);
        g.add(gear);
        this.gears.push({ gear, steer, lower, wheel, def: d, index: i });
      });
      // pós-combustor
      this.flames = [];
      for (const s of [-1, 1]) {
        const grp = new THREE.Group();
        grp.position.set(s * 0.7, -0.05, 8.2);
        const outer = new THREE.Mesh(new THREE.ConeGeometry(0.5, 4.2, 12, 1, true).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        outer.position.z = 2.1;
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.28, 2.6, 10, 1, true).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        inner.position.z = 1.4;
        grp.add(outer, inner);
        g.add(grp);
        this.flames.push({ grp, outer, inner });
      }
      // luz estroboscópica
      this.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), m.white);
      this.strobe.position.set(0, 3.8, 6.4);
      g.add(this.strobe);
    }

    part(geo, mat) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      return mesh;
    }

    // Atualiza animações a partir do estado do modelo de voo
    update(m, time) {
      const f = m.flapsPos;
      this.flaps.forEach((fl) => { fl.rotation.x = f * 0.62; });
      this.ailerons[0].rotation.x = m.da * 0.42;   // esquerda
      this.ailerons[1].rotation.x = -m.da * 0.42;  // direita
      const e = M.clamp(m.de + m.input.trim, -1.2, 1.2);
      this.stabs.forEach((s) => { s.rotation.x = -e * 0.45; });
      this.rudders.forEach((r) => { r.rotation.y = m.dr * 0.5; });

      const gp = m.gearPos;
      this.gears.forEach((gr) => {
        const i = gr.index;
        gr.gear.visible = gp > 0.02;
        if (i === 0) gr.gear.rotation.x = -(1 - gp) * 1.55;
        else gr.gear.rotation.z = (i === 1 ? 1 : -1) * (1 - gp) * 1.5;
        gr.lower.position.y = m.gearCompress[i];
        gr.wheel.rotation.x = m.gearSpin[i];
        if (i === 0) gr.steer.rotation.y = m.steerAngle;
      });

      const ab = M.smoothstep(0.78, 0.98, m.rpm);
      const idle = M.smoothstep(0.05, 0.3, m.rpm);
      this.flames.forEach((fl, k) => {
        const flick = 0.92 + 0.12 * Math.sin(time * 38 + k * 2) + 0.06 * Math.sin(time * 71);
        fl.grp.visible = m.rpm > 0.12 && !m.crashed;
        const len = (0.12 + idle * 0.18 + ab * 0.95) * flick;
        fl.grp.scale.set(0.7 + ab * 0.3, 0.7 + ab * 0.3, len);
        fl.outer.material.opacity = 0.18 + ab * 0.6;
        fl.inner.material.opacity = 0.25 + ab * 0.65;
      });
      this.strobe.visible = (time % 1.2) < 0.08;
    }
  }

  /* ===================================================== Estrutura do cockpit (filha da câmera) */
  class CockpitRig {
    constructor() {
      this.group = new THREE.Group();
      const dark = new THREE.MeshBasicMaterial({ color: 0x14161a });
      const mid = new THREE.MeshBasicMaterial({ color: 0x23272e });
      const add = (geo, mat, x, y, z, rx = 0, rz = 0) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.rotation.z = rz;
        mesh.renderOrder = 5;
        this.group.add(mesh);
        return mesh;
      };
      add(new THREE.BoxGeometry(7, 1.0, 0.4), dark, 0, -0.78, -1.25);              // fundo do painel
      add(new THREE.BoxGeometry(3.6, 0.07, 0.4), dark, 0, -0.2, -0.9, 0.22);      // protetor de reflexo
      add(new THREE.BoxGeometry(1.5, 0.7, 0.9), mid, -1.65, -0.62, -0.72);          // consoles laterais
      add(new THREE.BoxGeometry(1.5, 0.7, 0.9), mid, 1.65, -0.62, -0.72);
      // arcos da capota
      add(new THREE.BoxGeometry(0.06, 2.2, 0.06), dark, -1.3, 0.2, -0.85, 0, -0.2);
      add(new THREE.BoxGeometry(0.06, 2.2, 0.06), dark, 1.3, 0.2, -0.85, 0, 0.2);
      add(new THREE.BoxGeometry(2.8, 0.07, 0.07), dark, 0, 0.98, -0.85);

      // painel de instrumentos (textura em canvas, atualizada com dados reais)
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024; this.canvas.height = 352;
      this.ctx = this.canvas.getContext('2d');
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.anisotropy = 4;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.46), new THREE.MeshBasicMaterial({ map: this.tex }));
      panel.position.set(0, -0.47, -1.0);
      panel.rotation.x = -0.24;
      panel.renderOrder = 6;
      this.group.add(panel);
      this.group.visible = false;
      this.lastDraw = 0;
    }

    update(model, units, time, aspect) {
      if (!this.group.visible) return;
      const s = M.clamp(aspect / 1.7, 0.5, 1.05);
      this.group.scale.setScalar(s);
      this.group.position.set(0, -0.0, 0);
      if (time - this.lastDraw > 1 / 30) {
        this.lastDraw = time;
        FS.Instruments.drawPanel(this.ctx, this.canvas.width, this.canvas.height, model, units, time);
        this.tex.needsUpdate = true;
      }
    }
  }

  FS.Aircraft = Aircraft;
  FS.CockpitRig = CockpitRig;
})(typeof window !== 'undefined' ? window : globalThis);
