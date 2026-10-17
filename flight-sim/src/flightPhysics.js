/* flightPhysics.js — modelo de voo 6-DOF simplificado (SI), passo fixo.
 *
 * Eixos do corpo: +X direita, +Y para cima, nariz em -Z.
 *   ω = (wx, wy, wz): wx = arfagem (nariz para cima +), wy = guinada (nariz para esquerda +),
 *   rolagem para a direita = -wz.
 * Entradas (this.input): stickX (direita +), stickY (puxar/nariz para cima +), rudder (direita +),
 *   throttle 0..1, trim, brake 0..1, gearCmd 0/1, flapsIdx 0..3.
 */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const T = FS.Terrain;
  const G = 9.80665;
  const RHO0 = 1.225;

  const AC = {
    name: 'F-X Falcão',
    mass: 11000,
    I: [75000, 85000, 13000],             // inércia: arfagem (X), guinada (Y), rolagem (Z)
    S: 28, cbar: 3.5, b: 10,
    CL0: 0.1, CLa: 4.0, aStall: 0.30, CLflap: 0.5,
    CD0: 0.022, kInd: 0.125, CDgear: 0.015, CDflap: 0.03,
    Cm0: 0.0405, Cma: -0.45, Cmd: 0.30, Cmq: -12, Cmflap: -0.02,
    Clda: 0.07, Clp: -0.45, Clb: -0.06,
    Cnb: 0.12, Cndr: 0.08, Cnr: -0.35, Cnp: 0.012, CYb: -1.0,
    Tmax: 130000,
    flapsPositions: [0, 0.35, 0.65, 1.0],
    flapsNames: ['RECOLHIDO', 'DECOLAGEM', 'APROXIMAÇÃO', 'POUSO'],
    Vne: 420,           // m/s
    maxGear: 185,       // m/s: velocidade máxima com trem estendido
    maxFlaps: 220,      // m/s
    gearLen: 1.25,      // do ponto de fixação até a base da roda
    gearTravel: 0.45,
    gear: [
      { name: 'nose', p: [0, -0.9, -4.6], k: 140e3, c: 38e3, steer: true, brake: false },
      { name: 'left', p: [-1.5, -0.9, 1.2], k: 240e3, c: 48e3, steer: false, brake: true },
      { name: 'right', p: [1.5, -0.9, 1.2], k: 240e3, c: 48e3, steer: false, brake: true },
    ],
    belly: [[0, -0.95, -3.2], [0, -0.95, 0.6], [0, -0.95, 4.2]],
    tips: [[0, 0.1, -7.6], [0, 0.5, 7.6], [-5.5, 0, 2.8], [5.5, 0, 2.8], [-2.4, 2.7, 6.2], [2.4, 2.7, 6.2], [0, 1.15, -3.2]],
    ground: [[0, -0.95, 0]],
  };

  const density = (h) => RHO0 * Math.exp(-Math.max(h, 0) / 9100);
  const soundSpeed = (h) => Math.max(295, 340.3 - 0.0040 * Math.max(h, 0));

  class FlightModel {
    constructor() {
      this.ac = AC;
      this.input = { stickX: 0, stickY: 0, rudder: 0, throttle: 0, trim: 0, brake: 0, gearCmd: 1, flapsIdx: 0 };
      this.wind = [0, 0, 0];
      this.reset({ x: 0, z: 0 }, 0);
    }

    reset(spawn, headingDeg) {
      const gh = T.groundHeight(spawn.x, spawn.z);
      this.p = [spawn.x, gh + 1.95, spawn.z];
      this.v = [0, 0, 0];
      this.q = M.qFromHeading(headingDeg);
      this.w = [0, 0, 0];
      this.prevP = this.p.slice();
      this.prevQ = this.q.slice();
      this.time = 0;
      // atuadores / sistemas
      this.da = 0; this.de = 0; this.dr = 0;
      this.rpm = 0;
      this.enginePhase = 'off';       // off | starting | running
      this.startT = 0;
      this.heat = 0; this.overheated = false;
      this.gearPos = 1; this.gearDamaged = false;
      this.flapsPos = 0; this.flapsDamaged = false;
      this.input.throttle = 0; this.input.trim = 0; this.input.brake = 0;
      this.input.gearCmd = 1; this.input.flapsIdx = 0;
      this.input.stickX = 0; this.input.stickY = 0; this.input.rudder = 0;
      this.parkBrake = true;
      // estado
      this.crashed = false; this.crashReason = '';
      this.integrity = 100;
      this.onGround = true; this.airTime = 0; this.groundTime = 0;
      this.lastVy = 0;
      this.gearCompress = [0, 0, 0]; this.gearSpin = [0, 0, 0]; this.steerAngle = 0;
      this.bellyContact = false;
      this.touchdown = null;            // relatório do pouso
      this.rollout = 0;
      this.stallDrop = 1;
      this.msgs = [];
      this.alpha = 0; this.beta = 0; this.sigma = 0; this.nz = 1;
      this.V = 0; this.ias = 0; this.mach = 0; this.qbar = 0; this.agl = 2; this.thrust = 0;
      this.takeoffEvent = false;
      this.derive();
      this.settle();
    }

    settle() {
      for (let i = 0; i < 480; i++) this.step(1 / 240);
      this.v = [0, 0, 0]; this.w = [0, 0, 0];
      this.prevP = this.p.slice(); this.prevQ = this.q.slice();
      this.time = 0; this.touchdown = null; this.airTime = 0; this.groundTime = 0; this.msgs.length = 0;
    }

    /* ---- comandos discretos ---- */
    toggleGear() {
      if (this.gearDamaged) { this.msgs.push('TREM DANIFICADO'); return; }
      if (this.input.gearCmd === 1 && this.onGround) { this.msgs.push('NÃO É POSSÍVEL RECOLHER O TREM NO SOLO'); return; }
      this.input.gearCmd = this.input.gearCmd ? 0 : 1;
      this.msgs.push(this.input.gearCmd ? 'TREM ESTENDENDO' : 'TREM RECOLHENDO');
      this.events && this.events.gear && this.events.gear();
    }
    cycleFlaps() {
      if (this.flapsDamaged) { this.msgs.push('FLAPS DANIFICADOS'); return; }
      this.input.flapsIdx = (this.input.flapsIdx + 1) % AC.flapsPositions.length;
      this.msgs.push('FLAPS: ' + AC.flapsNames[this.input.flapsIdx]);
      this.events && this.events.flaps && this.events.flaps();
    }
    toggleEngine() {
      if (this.enginePhase === 'off') {
        if (this.onGround || this.V > 90) {
          this.enginePhase = 'starting'; this.startT = 0; this.msgs.push('PARTIDA DOS MOTORES');
        } else this.msgs.push('PARTIDA EM VOO EXIGE VELOCIDADE > 330 km/h');
      } else if (this.onGround && this.V < 8) {
        this.enginePhase = 'off'; this.msgs.push('MOTORES DESLIGADOS');
      } else this.msgs.push('MOTORES SÓ PODEM SER DESLIGADOS PARADO NO SOLO');
    }
    releaseParkBrake() { this.parkBrake = false; }

    /* ---- grandezas derivadas ---- */
    derive() {
      const f = M.qRot(this.q, [0, 0, -1]);
      const r = M.qRot(this.q, [1, 0, 0]);
      const u = M.qRot(this.q, [0, 1, 0]);
      this.fwd = f; this.rightV = r; this.upV = u;
      this.pitch = Math.asin(M.clamp(f[1], -1, 1));
      this.bank = Math.atan2(-r[1], u[1]);
      let h = Math.atan2(f[0], -f[2]);
      if (h < 0) h += 2 * Math.PI;
      this.heading = h;
      this.altitude = this.p[1];
      this.vs = this.v[1];
      this.gs = Math.hypot(this.v[0], this.v[2]);
    }

    /* ---- passo de simulação ---- */
    step(dt) {
      if (this.crashed) return;
      const ac = AC, inp = this.input;
      this.prevP = this.p.slice(); this.prevQ = this.q.slice();
      this.time += dt;
      this.derive();

      /* --- sistemas --- */
      this.updateEngine(dt);
      this.updateConfig(dt);

      const agl0 = this.p[1] - T.groundHeight(this.p[0], this.p[2]);
      this.agl = agl0;

      /* --- aerodinâmica --- */
      const vw = M.sub(this.v, this.wind);
      const vb = M.qRotInv(this.q, vw);
      const V = M.len(vb);
      const rho = density(this.p[1]);
      const qbar = 0.5 * rho * V * V;
      const mach = V / soundSpeed(this.p[1]);
      this.V = V; this.qbar = qbar; this.mach = mach;
      this.ias = V * Math.sqrt(rho / RHO0);

      let alpha = 0, beta = 0;
      if (V > 1) {
        alpha = Math.atan2(-vb[1], -vb[2]);
        beta = Math.asin(M.clamp(vb[0] / V, -1, 1));
      }
      this.alpha = alpha; this.beta = beta;

      // autoridade dos controles diminui com a velocidade (como no War Thunder)
      const authP = 1 / (1 + (V / 120) ** 2);
      const authR = 1 / (1 + (V / 200) ** 2);
      const authY = 1 / (1 + (V / 180) ** 2);

      // superfícies (com atraso do atuador)
      const k = 1 - Math.exp(-dt / 0.07);
      this.da += (M.clamp(inp.stickX, -1, 1) - this.da) * k;
      this.de += (M.clamp(inp.stickY, -1, 1) - this.de) * k;
      this.dr += (M.clamp(inp.rudder, -1, 1) - this.dr) * k;

      const flaps = this.flapsPos;
      const aS = ac.aStall + 0.05 * flaps;
      const aa = Math.abs(alpha);
      const sigma = M.smoothstep(aS, aS + 0.12, aa);
      this.sigma = sigma;
      this.stallWarn = M.smoothstep(aS - 0.07, aS - 0.01, aa);
      const aClamp = M.clamp(alpha, -aS, aS);
      const CLlin = ac.CL0 + ac.CLflap * flaps + ac.CLa * aClamp;
      const CLpost = 1.05 * Math.sin(2 * alpha);
      const CL = (1 - sigma) * CLlin + sigma * CLpost;

      const agl = Math.max(this.agl, 0.5);
      const ground = 1 - 0.4 * Math.exp(-agl / 5);
      let CD = ac.CD0 + ac.CDgear * this.gearPos + ac.CDflap * flaps
        + ac.kInd * CL * CL * ground
        + sigma * 1.25 * Math.sin(alpha) ** 2
        + 0.06 * M.smoothstep(0.85, 1.15, mach)
        + 0.8 * beta * beta;

      const Sq = qbar * ac.S;
      let Fb = [0, 0, 0];
      if (V > 0.5) {
        const vh = [vb[0] / V, vb[1] / V, vb[2] / V];
        const drag = M.mul(vh, -Sq * CD);
        let lift = [0, 0, 0];
        const ub = [0, 1, 0];
        const ld = M.sub(ub, M.mul(vh, vh[1]));
        const ll = M.len(ld);
        if (ll > 0.05) lift = M.mul(ld, (Sq * CL) / ll);
        Fb = M.add(drag, lift);
        Fb[0] += Sq * ac.CYb * beta;
      }

      // empuxo
      const g = this.thrustFraction();
      const dens = Math.pow(rho / RHO0, 0.75);
      const heatCut = this.overheated ? 0.7 : 1;
      this.thrust = ac.Tmax * g * dens * heatCut;
      Fb[2] -= this.thrust;

      // momentos aerodinâmicos
      const Vs = Math.max(V, 15);
      const pr = -this.w[2], qq = this.w[0], rr = this.w[1];
      const sb = Sq * ac.b, sc = Sq * ac.cbar;
      const ac_ = M.clamp(alpha, -0.9, 0.9);
      const Mx = sc * (ac.Cm0 + ac.Cma * ac_ + ac.Cmd * (this.de * authP + inp.trim)
        + ac.Cmq * (qq * ac.cbar / (2 * Vs)) + ac.Cmflap * flaps - 0.10 * sigma * M.sign(alpha));
      const My = -sb * (ac.Cnb * beta + ac.Cndr * this.dr * authY)
        + sb * (ac.Cnr * (rr * ac.b / (2 * Vs)))
        + sb * ac.Cnp * (pr * ac.b / (2 * Vs));
      const Mz = -sb * (ac.Clda * this.da * authR + ac.Clp * (pr * ac.b / (2 * Vs)) + ac.Clb * beta
        + 0.05 * sigma * this.stallDrop);
      if (sigma < 0.02 && aa < 0.1) this.stallDrop = Math.random() < 0.5 ? 1 : -1;
      let Mb = [Mx, My, Mz];

      /* --- solo --- */
      let Fw = M.qRot(this.q, Fb);
      Fw[1] -= G * ac.mass;
      let torqueW = [0, 0, 0];
      const contact = this.contactForces(Fw, torqueW, dt);
      Mb = M.add(Mb, M.qRotInv(this.q, torqueW));

      // fator de carga (excluindo gravidade)
      const specific = M.qRotInv(this.q, [Fw[0], Fw[1] + G * ac.mass, Fw[2]]);
      this.nz = specific[1] / (ac.mass * G);

      /* --- integração (Euler semi-implícito, passo fixo) --- */
      const a = M.mul(Fw, 1 / ac.mass);
      this.v = M.add(this.v, M.mul(a, dt));
      this.p = M.add(this.p, M.mul(this.v, dt));

      const I = ac.I, w = this.w;
      const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
      const gyro = M.cross(w, Iw);
      this.w = [
        w[0] + ((Mb[0] - gyro[0]) / I[0]) * dt,
        w[1] + ((Mb[1] - gyro[1]) / I[1]) * dt,
        w[2] + ((Mb[2] - gyro[2]) / I[2]) * dt,
      ];
      const wl = M.len(this.w);
      if (wl > 1e-6) this.q = M.qNorm(M.qMul(this.q, M.qFromAxisAngle([this.w[0] / wl, this.w[1] / wl, this.w[2] / wl], wl * dt)));

      /* --- colisões e limites estruturais --- */
      this.collisions(dt);
      this.structure(dt);
      this.derive();

      // decolagem / pouso (transições)
      if (!contact) {
        this.airTime += dt; this.groundTime = 0;
        this.lastVy = this.v[1];
        if (this.onGround && this.airTime > 0.15) { this.onGround = false; this.takeoffEvent = true; }
      } else {
        this.groundTime += dt;
        if (!this.onGround) this.onGround = true;
        this.airTime = 0;
      }
      if (this.onGround && this.touchdown && !this.touchdown.stopped) {
        this.touchdown.rollout = this.rollout;
        if (this.gs < 1.5 && this.groundTime > 1) {
          this.touchdown.stopped = true;
          this.msgs.push('AERONAVE PARADA');
        }
      }
    }

    thrustFraction() {
      const r = this.rpm;
      return r < 0.8 ? 0.62 * Math.pow(Math.max(r, 0) / 0.8, 1.6) : 0.62 + 0.38 * ((r - 0.8) / 0.2);
    }

    updateEngine(dt) {
      let target = 0;
      if (this.enginePhase === 'starting') {
        this.startT += dt;
        target = Math.min(0.15, (this.startT / 6) * 0.17);
        if (this.startT >= 6) { this.enginePhase = 'running'; this.msgs.push('MOTORES LIGADOS'); }
      } else if (this.enginePhase === 'running') {
        target = 0.15 + 0.85 * M.clamp(this.input.throttle, 0, 1);
      }
      const tau = this.enginePhase === 'off' ? 3.5 : target > this.rpm ? 1.6 : 1.0;
      this.rpm += (target - this.rpm) * (1 - Math.exp(-dt / tau));
      if (this.enginePhase === 'off' && this.rpm < 0.002) this.rpm = 0;
      // superaquecimento (pós-combustor prolongado)
      if (this.rpm > 0.92) this.heat += 0.02 * dt; else this.heat -= 0.03 * dt;
      this.heat = M.clamp(this.heat, 0, 1.2);
      if (this.heat >= 1 && !this.overheated) { this.overheated = true; this.msgs.push('SUPERAQUECIMENTO DO MOTOR'); }
      if (this.overheated && this.heat < 0.6) this.overheated = false;
    }

    updateConfig(dt) {
      const gt = this.input.gearCmd;
      if (this.gearDamaged) { /* travado */ } else if (this.gearPos !== gt) {
        const d = gt - this.gearPos;
        this.gearPos += M.clamp(d, -dt / 4, dt / 4);
      }
      const ft = AC.flapsPositions[this.input.flapsIdx];
      if (this.flapsPos !== ft) this.flapsPos += M.clamp(ft - this.flapsPos, -dt * 0.2, dt * 0.2);
      if (this.parkBrake && this.input.throttle > 0.3) this.parkBrake = false;
      // limites de velocidade
      if (this.gearPos > 0.05 && this.V > AC.maxGear && !this.gearDamaged) {
        this.gearDamaged = true;
        this.msgs.push('TREM DANIFICADO: VELOCIDADE EXCESSIVA');
      }
      if (this.flapsPos > 0.05 && this.V > AC.maxFlaps && !this.flapsDamaged) {
        this.flapsDamaged = true; this.input.flapsIdx = 0; this.flapsPos = 0;
        this.msgs.push('FLAPS ARRANCADOS: VELOCIDADE EXCESSIVA');
      }
    }

    /* ---- contato com o solo: rodas (suspensão), barriga (patim) ---- */
    contactForces(Fw, torqueW, dt) {
      const ac = AC;
      if (this.p[1] - T.groundHeight(this.p[0], this.p[2]) > 30) {
        this.gearCompress[0] = this.gearCompress[1] = this.gearCompress[2] = 0;
        this.bellyContact = false;
        return false;
      }
      let any = false;
      this.bellyContact = false;
      const wGear = this.gearPos > 0.95 && !this.gearDamaged;
      const Vg = this.gs;
      const brakeCmd = Math.max(this.input.brake, this.parkBrake ? 1 : 0);
      this.steerAngle = -this.input.rudder * 0.55 * M.clamp(1 - Vg / 45, 0.2, 1);

      const applyAt = (pBody, mode, idx, params) => {
        const rW = M.qRot(this.q, pBody);
        const pw = [this.p[0] + rW[0], this.p[1] + rW[1], this.p[2] + rW[2]];
        const gh = T.groundHeight(pw[0], pw[2]);
        let compress;
        if (mode === 'wheel') {
          const down = M.qRot(this.q, [0, -1, 0]);
          const cosd = Math.max(0.5, -down[1]);
          compress = ac.gearLen - (pw[1] - gh) / cosd;
        } else compress = gh - pw[1];
        if (compress <= 0) { if (mode === 'wheel') this.gearCompress[idx] = 0; return; }
        // velocidade do ponto
        const wW = M.qRot(this.q, this.w);
        const vp = M.add(this.v, M.cross(wW, rW));
        const surf = T.surfaceAt(pw[0], pw[2]);
        const n = T.normalAt(pw[0], pw[2]);
        const vn = M.dot(vp, n);
        if (surf === T.SURF.WATER && pw[1] < -0.3) { this.crash('IMPACTO NA ÁGUA'); return; }
        const cmax = mode === 'wheel' ? ac.gearTravel : 1e9;
        const cc = Math.min(compress, cmax);
        let N = params.k * cc - params.c * vn;
        if (compress > cmax) N += params.k * 6 * (compress - cmax);
        if (N < 0) N = 0;
        if (mode === 'wheel') {
          this.gearCompress[idx] = cc;
          if (compress > cmax * 0.98 && -vn > 5) this.integrity -= (-vn - 5) * 6 * dt * 60 * 0.05;
        }
        any = true;
        if (mode === 'belly') this.bellyContact = true;

        // direção do rolamento
        let fdir = M.qRot(this.q, [0, 0, -1]);
        if (params.steer) {
          const qs = M.qMul(this.q, M.qFromAxisAngle([0, 1, 0], this.steerAngle));
          fdir = M.qRot(qs, [0, 0, -1]);
        }
        fdir = M.sub(fdir, M.mul(n, M.dot(fdir, n)));
        fdir = M.norm(fdir);
        const side = M.cross(fdir, n);
        const vLong = M.dot(vp, fdir), vLat = M.dot(vp, side);
        const asphalt = surf === T.SURF.ASPHALT;
        const muRoll = mode === 'belly' ? 0.45 : asphalt ? 0.025 : surf === T.SURF.SAND ? 0.12 : 0.07;
        const muLat = mode === 'belly' ? 0.5 : asphalt ? 0.9 : 0.55;
        const muBrake = asphalt ? 0.55 : 0.3;
        let longCoef = muRoll;
        if (params.brake) longCoef += muBrake * brakeCmd;
        const sv = M.clamp(vLong / 0.4, -1, 1);
        const FL = -N * longCoef * sv;
        const FS_ = -N * muLat * M.clamp(vLat / 0.4, -1, 1);
        const F = [
          n[0] * N + fdir[0] * FL + side[0] * FS_,
          n[1] * N + fdir[1] * FL + side[1] * FS_,
          n[2] * N + fdir[2] * FL + side[2] * FS_,
        ];
        Fw[0] += F[0]; Fw[1] += F[1]; Fw[2] += F[2];
        const tq = M.cross(rW, F);
        torqueW[0] += tq[0]; torqueW[1] += tq[1]; torqueW[2] += tq[2];
        if (mode === 'wheel') this.gearSpin[idx] += (vLong / 0.35) * dt;
        if (mode === 'belly') {
          this.integrity -= 25 * dt * (0.3 + Math.min(1, Vg / 40));
          if (-vn > 3.5) this.crash('POUSO DE BARRIGA SEM TREM');
        }
      };

      if (wGear) {
        for (let i = 0; i < ac.gear.length; i++) {
          const gdef = ac.gear[i];
          // contato "primeira roda": registra o toque
          const before = any;
          const vyBefore = this.v[1];
          applyAt(gdef.p, 'wheel', i, gdef);
          if (!before && any && this.airTime > 0.4 && !this.touchdownLatched) {
            this.registerTouchdown(-vyBefore);
          }
        }
      } else {
        for (let i = 0; i < 3; i++) this.gearCompress[i] = 0;
        for (let i = 0; i < ac.belly.length; i++) applyAt(ac.belly[i], 'belly', i, { k: 3.0e5, c: 7e4, steer: false, brake: false });
      }
      if (!any && this.airTime > 1.5) this.touchdownLatched = false;
      if (any && this.touchdown && this.gs > 1) this.rollout += this.gs * dt;
      return any;
    }

    registerTouchdown(sink) {
      if (this.touchdownLatched) return;
      this.touchdownLatched = true;
      const ap = T.airportAt(this.p[0], this.p[2], 5000);
      let onRunway = false, off = 0, hErr = 0, rwy = '', along = 0;
      if (ap) {
        const l = ap.local(this.p[0], this.p[2]);
        onRunway = l[0] >= ap.runwayRect[0] && l[0] <= ap.runwayRect[1] && Math.abs(l[1]) <= ap.width / 2 + 3;
        off = l[1];
        const h = this.heading / M.DEG;
        along = Math.cos((this.heading - ap.heading * M.DEG)) >= 0 ? l[0] + ap.length / 2 : ap.length / 2 - l[0];
        const rh = ap.heading;
        let d1 = Math.abs(((h - rh + 540) % 360) - 180);
        let d2 = Math.abs(((h - rh - 180 + 540) % 360) - 180);
        hErr = Math.min(d1, d2);
        rwy = ap.id;
      }
      const speedKmh = this.gs * 3.6;
      const bank = Math.abs(this.bank) / M.DEG;
      const pitch = this.pitch / M.DEG;
      const reasons = [];
      let score = 0; // 0 perfeito, 1 seguro, 2 brusco, 3 acidente
      const bump = (lvl, why) => { if (lvl > score) score = lvl; reasons.push(why); };
      if (sink > 7.5) bump(3, 'razão de descida excessiva (' + sink.toFixed(1) + ' m/s)');
      else if (sink > 4) bump(2, 'razão de descida alta (' + sink.toFixed(1) + ' m/s)');
      else if (sink > 2.4) bump(1, 'toque firme (' + sink.toFixed(1) + ' m/s)');
      if (speedKmh > 420) bump(3, 'velocidade de toque muito alta (' + speedKmh.toFixed(0) + ' km/h)');
      else if (speedKmh > 340) bump(2, 'velocidade de toque alta (' + speedKmh.toFixed(0) + ' km/h)');
      else if (speedKmh > 310) bump(1, 'velocidade de toque acima do ideal (' + speedKmh.toFixed(0) + ' km/h)');
      if (bank > 20) bump(3, 'inclinação lateral excessiva (' + bank.toFixed(0) + '°)');
      else if (bank > 9) bump(2, 'inclinação lateral alta (' + bank.toFixed(0) + '°)');
      else if (bank > 4) bump(1, 'asa baixa no toque (' + bank.toFixed(0) + '°)');
      if (!onRunway) bump(ap ? 2 : 2, ap ? 'toque fora da pista' : 'pouso fora de aeroporto');
      if (ap && onRunway) {
        if (hErr > 15) bump(3, 'desalinhado com a pista (' + hErr.toFixed(0) + '°)');
        else if (hErr > 8) bump(2, 'mau alinhamento (' + hErr.toFixed(0) + '°)');
        else if (hErr > 3) bump(1, 'alinhamento regular (' + hErr.toFixed(0) + '°)');
        if (Math.abs(off) > 15) bump(2, 'longe do eixo da pista (' + Math.abs(off).toFixed(0) + ' m)');
        else if (Math.abs(off) > 7) bump(1, 'fora do eixo (' + Math.abs(off).toFixed(0) + ' m)');
      }
      if (this.flapsPos < 0.3 && speedKmh > 280) bump(1, 'flaps não configurados para pouso');
      if (pitch > 14) bump(2, 'arfagem excessiva');
      const names = ['POUSO PERFEITO', 'POUSO SEGURO', 'POUSO BRUSCO', 'ACIDENTE'];
      if (score >= 2) this.integrity -= (score === 3 ? 60 : 12) + Math.max(0, sink - 3) * 4;
      this.touchdown = {
        rating: names[score], level: score, sink, speedKmh, bank, pitch, offset: off, headingError: hErr,
        onRunway, airport: rwy, along, reasons, rollout: 0, stopped: false,
        gear: this.gearPos > 0.95, flaps: this.flapsPos,
      };
      this.rollout = 0;
      if (this.integrity <= 0 || score === 3) { this.crash('POUSO COM IMPACTO EXCESSIVO'); }
      else this.events && this.events.touch && this.events.touch(sink);
    }

    /* ---- colisões (pontas, construções, solo) ---- */
    collisions(dt) {
      const ac = AC;
      if (this.crashed) return;
      const check = (pBody, kind, label) => {
        const r = M.qRot(this.q, pBody);
        const x = this.p[0] + r[0], y = this.p[1] + r[1], z = this.p[2] + r[2];
        const gh = T.groundHeight(x, z);
        if (y < gh - 0.05) {
          if (kind === 'ground') return;
          this.crash(T.heightAt(x, z) < 0 ? 'IMPACTO NA ÁGUA' : label || 'COLISÃO COM O TERRENO');
          return;
        }
        const hit = T.hitsBuilding(x, y, z);
        if (hit) this.crash(hit.kind === 'city' ? 'COLISÃO COM EDIFÍCIO' : 'COLISÃO COM ESTRUTURA DO AEROPORTO');
      };
      const nearGround = this.p[1] - T.groundHeight(this.p[0], this.p[2]) < 25;
      if (nearGround || T.hasColliders(this.p[0], this.p[2])) {
        for (let i = 0; i < ac.tips.length; i++) {
          check(ac.tips[i], 'tip', i === 1 ? 'BATIDA DE CAUDA NO SOLO' : i === 2 || i === 3 ? 'ASA TOCOU O SOLO' : null);
          if (this.crashed) return;
        }
        if (this.gearPos > 0.5) {
          for (const g of ac.gear) { check([g.p[0], g.p[1] - 0.3, g.p[2]], 'gearpt'); if (this.crashed) return; }
        }
      }
      // pontos de fuselagem: dentro do solo = acidente (exceto deslizamento de barriga já tratado)
      if (nearGround) {
        const r = M.qRot(this.q, [0, 0.2, 0]);
        const y = this.p[1] + r[1];
        if (y < T.groundHeight(this.p[0] + r[0], this.p[2] + r[2])) this.crash('COLISÃO COM O TERRENO');
      }
    }

    structure(dt) {
      const nz = this.nz;
      if (Math.abs(nz) > 11) this.integrity -= (Math.abs(nz) - 11) * 8 * dt;
      if (this.V > AC.Vne) this.integrity -= (this.V - AC.Vne) * 0.2 * dt;
      this.overG = Math.abs(nz) > 9;
      this.overSpeed = this.V > AC.Vne * 0.92;
      if (this.integrity <= 0 && !this.crashed) {
        this.crash(Math.abs(nz) > 11 ? 'FALHA ESTRUTURAL: SOBRECARGA' : this.V > AC.Vne ? 'FALHA ESTRUTURAL: EXCESSO DE VELOCIDADE' : 'AERONAVE DESTRUÍDA');
      }
    }

    crash(reason) {
      if (this.crashed) return;
      this.crashed = true;
      this.crashReason = reason;
      this.crashSpeed = this.V;
      if (this.touchdown) { this.touchdown.rating = 'ACIDENTE'; this.touchdown.level = 3; }
      else this.touchdown = { rating: 'ACIDENTE', level: 3, sink: -this.v[1], speedKmh: this.gs * 3.6, bank: Math.abs(this.bank) / M.DEG, pitch: this.pitch / M.DEG,
        offset: 0, headingError: 0, onRunway: false, airport: '', reasons: [reason], rollout: 0, stopped: true };
      this.events && this.events.crash && this.events.crash(reason);
    }
  }

  FS.AC = AC;
  FS.FlightModel = FlightModel;
  FS.Atmosphere = { density, soundSpeed, G };
})(typeof window !== 'undefined' ? window : globalThis);
