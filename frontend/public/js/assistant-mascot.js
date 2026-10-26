/**
 * Mascota "Balvo" del asistente IA: esfera 3D amigable que flota, parpadea,
 * mira hacia el cursor, se emociona, piensa y celebra.
 *
 * - three.js se carga diferido desde jsDelivr (misma versión que inventory-yard3d.js).
 * - Solo anima cuando la mascota es visible (IntersectionObserver), la pestaña
 *   está activa y la instancia está marcada como activa.
 * - Con prefers-reduced-motion, sin WebGL o si falla el CDN se queda el SVG.
 *
 * API: AssistantMascot.create(host, { size }) -> { setMood, setExcited, react, setActive, destroy }
 *      AssistantMascot.avatarSvg() -> SVG estático para avatares de mensajes.
 */
(function (global) {
  'use strict';

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';
  const doc = global.document;
  const reduceMq = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  const instances = new Set();
  const pointer = { x: 0, y: 0, t: -1e9 };
  let threePromise = null;
  let webglSupport = null;
  let rafId = 0;
  let pointerRaf = 0;

  /* ---------- Carga diferida de three.js ---------- */

  function loadThree() {
    if (global.THREE) return Promise.resolve(global.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(), 15000);
      function done() {
        clearTimeout(timer);
        if (global.THREE) resolve(global.THREE);
        else fail();
      }
      function fail() {
        clearTimeout(timer);
        threePromise = null;
        reject(new Error('No se pudo cargar three.js'));
      }
      // Si el mapa 3D del patio ya pidió three.js, reutilizamos su <script>.
      let s = doc.querySelector(`script[src="${THREE_URL}"]`);
      if (!s) {
        s = doc.createElement('script');
        s.src = THREE_URL;
        s.async = true;
        doc.head.appendChild(s);
      }
      s.addEventListener('load', done, { once: true });
      s.addEventListener('error', fail, { once: true });
    });
    return threePromise;
  }

  function webglOk() {
    if (webglSupport !== null) return webglSupport;
    try {
      const c = doc.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      webglSupport = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webglSupport = false;
    }
    return webglSupport;
  }

  /* ---------- Respaldo SVG (también se ve mientras carga three.js) ---------- */

  function svgMarkup(extraClass = '', viewBox = '0 0 120 120') {
    return `
      <svg class="ai-dot__svg ${extraClass}" viewBox="${viewBox}" aria-hidden="true" focusable="false">
        <ellipse class="ai-dot__svg-shadow" cx="60" cy="110" rx="22" ry="4"/>
        <g class="ai-dot__svg-float">
          <g class="ai-dot__svg-arm ai-dot__svg-arm--l"><ellipse cx="24" cy="70" rx="6.5" ry="10"/></g>
          <g class="ai-dot__svg-arm ai-dot__svg-arm--r"><ellipse cx="96" cy="70" rx="6.5" ry="10"/></g>
          <line class="ai-dot__svg-antenna" x1="60" y1="27" x2="60" y2="15"/>
          <circle class="ai-dot__svg-tip" cx="60" cy="12" r="5.5"/>
          <circle class="ai-dot__svg-body" cx="60" cy="62" r="35"/>
          <path class="ai-dot__svg-belly" d="M29 74 A35 35 0 0 0 91 74 A40 30 0 0 1 29 74 Z"/>
          <ellipse class="ai-dot__svg-gloss" cx="45" cy="42" rx="11" ry="6" transform="rotate(-32 45 42)"/>
          <g class="ai-dot__svg-face">
            <rect class="ai-dot__svg-visor" x="35" y="49" width="50" height="31" rx="15.5"/>
            <g class="ai-dot__svg-eyes">
              <rect class="ai-dot__svg-eye" x="47" y="56" width="7.5" height="12" rx="3.75"/>
              <rect class="ai-dot__svg-eye" x="65.5" y="56" width="7.5" height="12" rx="3.75"/>
            </g>
            <circle class="ai-dot__svg-cheek" cx="42" cy="72" r="3"/>
            <circle class="ai-dot__svg-cheek" cx="78" cy="72" r="3"/>
            <path class="ai-dot__svg-mouth" d="M55.5 72.5 Q60 76.5 64.5 72.5"/>
          </g>
        </g>
      </svg>`;
  }

  function avatarSvg() {
    return `<span class="ai-dot ai-dot--avatar" aria-hidden="true">${svgMarkup('ai-dot__svg--static', '18 4 84 98')}</span>`;
  }

  /* ---------- Escena 3D ---------- */

  function buildScene(THREE, size) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.className = 'ai-dot__canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0.2, 6.6);
    camera.lookAt(0, 0.15, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5d8a, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-2.5, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd0ff, 0.55);
    rim.position.set(3, 1.5, -2.5);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    // Cuerpo: esfera con degradado vertical (azul claro arriba, azul Balderrama abajo).
    const bodyGeo = new THREE.SphereGeometry(1, 48, 32);
    const top = new THREE.Color(0x7f9bff);
    const bottom = new THREE.Color(0x1e40d8);
    const colors = [];
    const pos = bodyGeo.attributes.position;
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const t = (pos.getY(i) + 1) / 2;
      tmp.copy(bottom).lerp(top, Math.pow(t, 0.9));
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    bodyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.32, metalness: 0.08,
    }));
    bodyGroup.add(body);

    // Visor: elipse proyectada sobre la superficie de la esfera.
    const face = new THREE.Group();
    bodyGroup.add(face);
    const R = 1.012;
    function onSphere(geo, sx, sy, oy, r = R, ox = 0) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i += 1) {
        const x = p.getX(i) * sx + ox;
        const y = p.getY(i) * sy + oy;
        p.setXYZ(i, x, y, Math.sqrt(Math.max(0.0001, r * r - x * x - y * y)));
      }
      geo.computeVertexNormals();
      return geo;
    }
    const visorGeo = onSphere(new THREE.RingGeometry(0.0001, 1, 48, 10), 0.64, 0.42, -0.02);
    face.add(new THREE.Mesh(visorGeo, new THREE.MeshStandardMaterial({
      color: 0x0c1838, roughness: 0.18, metalness: 0.2,
    })));

    // Ojos (brillan) dentro del visor; el grupo se desplaza para "mirar".
    const eyes = new THREE.Group();
    face.add(eyes);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff });
    const eyeGeo = new THREE.SphereGeometry(0.1, 20, 14);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.21, 0.05, 1.0);
    eyeR.position.set(0.21, 0.05, 1.0);
    eyes.add(eyeL, eyeR);

    // Mejillas y boca.
    const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff7eb0, transparent: true, opacity: 0.55, depthWrite: false });
    [-0.4, 0.4].forEach((ox) => {
      face.add(new THREE.Mesh(
        onSphere(new THREE.RingGeometry(0.0001, 1, 20, 3), 0.065, 0.045, -0.15, 1.016, ox),
        cheekMat,
      ));
    });

    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff });
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20, Math.PI), mouthMat);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.15, 1.006);
    const ooh = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.016, 8, 16), mouthMat);
    ooh.position.set(0, -0.17, 1.004);
    face.add(smile, ooh);

    // Antena con punta luminosa.
    const antenna = new THREE.Group();
    antenna.position.set(0, 0.98, 0);
    bodyGroup.add(antenna);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.035, 0.32, 10),
      new THREE.MeshStandardMaterial({ color: 0x9fb6d8, roughness: 0.4 }),
    );
    stem.position.y = 0.14;
    antenna.add(stem);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), tipMat);
    tip.position.y = 0.34;
    antenna.add(tip);

    // Brazos: el pivote está en el hombro para poder saludar.
    const armMat = new THREE.MeshStandardMaterial({ color: 0x2f6fe8, roughness: 0.35 });
    const armGeo = new THREE.SphereGeometry(0.17, 16, 12);
    function makeArm(side) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.9, -0.12, 0.05);
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.scale.set(0.9, 1.45, 0.9);
      arm.position.set(side * 0.06, -0.24, 0);
      pivot.add(arm);
      root.add(pivot);
      return pivot;
    }
    const armL = makeArm(-1);
    const armR = makeArm(1);

    // Puntitos que orbitan mientras "piensa".
    const orbit = new THREE.Group();
    orbit.position.y = 0.2;
    root.add(orbit);
    const orbitMat = new THREE.MeshBasicMaterial({ color: 0xffc04d });
    const orbitDots = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), orbitMat);
      orbit.add(m);
      return m;
    });

    // Sombra suave en el piso (textura radial).
    const sc = doc.createElement('canvas');
    sc.width = 64;
    sc.height = 64;
    const sctx = sc.getContext('2d');
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(15,27,61,0.45)');
    grad.addColorStop(1, 'rgba(15,27,61,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const shadowTex = new THREE.CanvasTexture(sc);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.9),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.32;
    scene.add(shadow);

    return {
      THREE, renderer, canvas, scene, camera,
      parts: {
        root, bodyGroup, face, eyes, eyeL, eyeR, cheekMat, smile, ooh,
        tip, tipMat, armL, armR, orbit, orbitDots, shadow,
      },
      tipIdle: new THREE.Color(0x7fe0ff),
      tipThink: new THREE.Color(0xffb020),
      tipTmp: new THREE.Color(),
    };
  }

  function disposeScene(gl) {
    if (!gl) return;
    gl.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { m?.map?.dispose?.(); m?.dispose?.(); });
    });
    gl.renderer.dispose();
    gl.renderer.forceContextLoss?.();
    gl.canvas.remove();
  }

  /* ---------- Animación ---------- */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const bell = (p) => Math.sin(Math.PI * clamp(p, 0, 1));

  function tick(inst, now) {
    const gl = inst.gl;
    const s = inst.anim;
    const p = gl.parts;
    const fast = inst.excited || inst.mood === 'thinking' || inst.reactName;
    // ~30 fps en reposo; fluido cuando hay interacción.
    if (!fast && now - s.lastRender < 32) return;
    const dt = clamp((now - (s.lastRender || now)) / 1000, 0, 0.05);
    s.lastRender = now;
    const t = now / 1000;
    const k = (rate) => 1 - Math.exp(-rate * dt);

    s.excite += ((inst.excited ? 1 : 0) - s.excite) * k(8);
    s.think += ((inst.mood === 'thinking' ? 1 : 0) - s.think) * k(5);

    let rp = -1;
    if (inst.reactName) {
      rp = (now - inst.reactStart) / inst.reactDur;
      if (rp >= 1) { inst.reactName = null; rp = -1; }
    }
    const celebrate = inst.reactName === 'celebrate' ? rp : -1;
    const wave = inst.reactName === 'wave' ? rp : -1;
    const oops = inst.reactName === 'oops' ? rp : -1;

    // Hacia dónde mira: cursor reciente, arriba si piensa, o deambula.
    let tx;
    let ty;
    if (s.think > 0.5) {
      tx = -0.55 + Math.sin(t * 0.9) * 0.15;
      ty = 0.7;
    } else if (now - pointer.t < 6000) {
      const r = inst.host.getBoundingClientRect();
      tx = clamp((pointer.x - (r.left + r.width / 2)) / 280, -1, 1);
      ty = clamp(-(pointer.y - (r.top + r.height / 2)) / 240, -1, 1);
    } else {
      tx = Math.sin(t * 0.37) * 0.55 + Math.sin(t * 0.13) * 0.3;
      ty = Math.sin(t * 0.29 + 1) * 0.3;
    }
    s.lookX += (tx - s.lookX) * k(6);
    s.lookY += (ty - s.lookY) * k(6);

    // Parpadeo aleatorio (a veces doble).
    if (now > s.nextBlink) {
      s.blinkStart = now;
      s.nextBlink = now + (Math.random() < 0.2 ? 260 : 2200 + Math.random() * 3200);
    }
    const bt = (now - s.blinkStart) / 150;
    const eyeOpen = bt < 1 ? Math.max(0.08, Math.abs(1 - 2 * bt)) : 1;

    // Cuerpo: flota, respira, rebota al emocionarse, salta al celebrar.
    const jump = celebrate >= 0 ? bell(celebrate * 1.15) * 0.3 : 0;
    const floatY = Math.sin(t * 1.7) * 0.07 + s.excite * Math.abs(Math.sin(t * 8)) * 0.14 + jump;
    p.root.position.y = floatY;
    const breath = Math.sin(t * 1.7 + 0.6) * 0.018;
    const land = celebrate > 0.82 ? bell((celebrate - 0.82) / 0.18) * 0.1 : 0;
    p.bodyGroup.scale.set(1 + breath + land, 1 - breath - land, 1 + breath + land);

    const spin = celebrate >= 0 ? ease(clamp(celebrate / 0.8, 0, 1)) * Math.PI * 2 : 0;
    const shake = oops >= 0 ? Math.sin(oops * Math.PI * 6) * 0.35 * bell(oops) : 0;
    p.root.rotation.y = s.lookX * 0.5 + spin + shake;
    p.root.rotation.x = -s.lookY * 0.26;
    p.root.rotation.z = s.think * Math.sin(t * 2.2) * 0.1 - s.lookX * 0.05;

    p.eyes.position.x = s.lookX * 0.07;
    p.eyes.position.y = s.lookY * 0.05;
    const happy = Math.max(celebrate >= 0 ? bell(celebrate) : 0, s.excite * 0.55);
    const eyeY = (1.45 + s.excite * 0.2) * eyeOpen * (1 - happy * 0.55) * (oops >= 0 ? 0.7 : 1);
    p.eyeL.scale.set(1 + s.excite * 0.12, eyeY, 0.55);
    p.eyeR.scale.copy(p.eyeL.scale);
    p.cheekMat.opacity = 0.4 + s.excite * 0.35 + happy * 0.2;

    // Boca: sonrisa en reposo, "o" al pensar.
    const smileScale = 1 + happy * 0.5 - s.think;
    p.smile.scale.set(Math.max(0.001, smileScale), Math.max(0.001, smileScale * (oops >= 0 ? 0.4 : 1)), 1);
    p.smile.visible = smileScale > 0.02;
    p.ooh.scale.setScalar(Math.max(0.001, s.think));
    p.ooh.visible = s.think > 0.02;

    // Antena: cian en reposo, ámbar pulsante al pensar, arcoíris al celebrar.
    if (celebrate >= 0) {
      p.tipMat.color.setHSL((t * 1.5) % 1, 0.85, 0.62);
    } else {
      gl.tipTmp.copy(gl.tipIdle).lerp(gl.tipThink, s.think);
      p.tipMat.color.copy(gl.tipTmp);
    }
    const pulse = 1 + (s.think * 0.35 + 0.08) * Math.sin(t * (4 + s.think * 4));
    p.tip.scale.setScalar(pulse);

    // Brazos.
    const sway = Math.sin(t * 1.7) * 0.07;
    let left = 0.28 + sway + s.excite * (0.9 + Math.sin(t * 11) * 0.3);
    let right = 0.28 - sway + s.excite * (0.9 + Math.sin(t * 11 + 1.5) * 0.3);
    if (wave >= 0) {
      const env = bell(wave);
      right = right * (1 - env) + env * (2.35 + Math.sin(t * 15) * 0.4);
    }
    if (celebrate >= 0) {
      const env = bell(celebrate);
      left = left * (1 - env) + env * (2.6 + Math.sin(t * 18) * 0.25);
      right = right * (1 - env) + env * (2.6 + Math.sin(t * 18 + 2) * 0.25);
    }
    if (s.think > 0.01) {
      // Una mano a la "barbilla" mientras piensa.
      right = right * (1 - s.think) + s.think * (1.15 + Math.sin(t * 3) * 0.05);
    }
    p.armL.rotation.z = -left;
    p.armR.rotation.z = right;

    // Puntitos de "pensando".
    p.orbit.visible = s.think > 0.02;
    if (p.orbit.visible) {
      p.orbitDots.forEach((d, i) => {
        const a = t * 2.6 + (i * Math.PI * 2) / 3;
        d.position.set(Math.cos(a) * 1.35, 0.85 + Math.sin(a * 2) * 0.08, Math.sin(a) * 0.5);
        d.scale.setScalar(s.think * (0.8 + 0.3 * Math.sin(t * 6 + i)));
      });
    }

    const sh = clamp(1 - floatY * 0.9, 0.45, 1.1);
    p.shadow.scale.set(sh, sh, sh);
    p.shadow.material.opacity = sh;

    gl.renderer.render(gl.scene, gl.camera);
  }

  function loop(now) {
    rafId = 0;
    let any = false;
    instances.forEach((inst) => {
      if (inst.running && inst.gl) {
        any = true;
        tick(inst, now);
      }
    });
    if (any) rafId = global.requestAnimationFrame(loop);
  }

  function kick() {
    if (!rafId) rafId = global.requestAnimationFrame(loop);
  }

  // Ojos del respaldo SVG: solo variables CSS, una vez por cuadro.
  function updateSvgLook() {
    pointerRaf = 0;
    instances.forEach((inst) => {
      if (inst.gl || !inst.running) return;
      const r = inst.host.getBoundingClientRect();
      const lx = clamp((pointer.x - (r.left + r.width / 2)) / 280, -1, 1);
      const ly = clamp((pointer.y - (r.top + r.height / 2)) / 240, -1, 1);
      inst.host.style.setProperty('--ai-dot-lx', lx.toFixed(2));
      inst.host.style.setProperty('--ai-dot-ly', ly.toFixed(2));
    });
  }

  function onPointer(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.t = performance.now();
    if (!pointerRaf && !reduceMq.matches) pointerRaf = global.requestAnimationFrame(updateSvgLook);
  }

  function syncAll() {
    instances.forEach((inst) => inst.sync());
  }

  /* ---------- Instancias ---------- */

  function create(host, opts = {}) {
    if (!host) return null;
    const size = opts.size || 64;
    host.classList.add('ai-dot');
    host.setAttribute('aria-hidden', 'true');
    host.style.setProperty('--ai-dot-size', `${size}px`);
    host.innerHTML = svgMarkup();

    const inst = {
      host,
      size,
      mood: 'idle',
      excited: false,
      active: opts.active !== false,
      inView: false,
      running: false,
      gl: null,
      loading3d: false,
      failed3d: false,
      destroyed: false,
      reactName: null,
      reactStart: 0,
      reactDur: 0,
      reactTimer: 0,
      anim: {
        excite: 0, think: 0, lookX: 0, lookY: 0,
        nextBlink: performance.now() + 1500, blinkStart: -1e9, lastRender: 0,
      },
    };

    function renderStatic() {
      if (inst.gl && !inst.destroyed) {
        inst.anim.lastRender = 0;
        tick(inst, performance.now());
      }
    }

    function try3d() {
      if (inst.gl || inst.loading3d || inst.failed3d || reduceMq.matches || !webglOk()) return;
      inst.loading3d = true;
      loadThree()
        .then((THREE) => {
          inst.loading3d = false;
          if (inst.destroyed) return;
          const gl = buildScene(THREE, size);
          gl.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            inst.failed3d = true;
            disposeScene(inst.gl);
            inst.gl = null;
            host.classList.remove('ai-dot--3d');
          });
          host.appendChild(gl.canvas);
          inst.gl = gl;
          renderStatic();
          host.classList.add('ai-dot--3d');
          inst.sync();
        })
        .catch(() => {
          inst.loading3d = false;
          inst.failed3d = true;
        });
    }

    inst.sync = function sync() {
      const reduce = reduceMq.matches;
      host.classList.toggle('ai-dot--paused', !inst.active || doc.hidden || !inst.inView);
      inst.running = !inst.destroyed && inst.active && inst.inView && !doc.hidden && !reduce;
      if (inst.running) {
        try3d();
        if (inst.gl) kick();
      }
    };

    const io = 'IntersectionObserver' in global
      ? new IntersectionObserver((entries) => {
        inst.inView = entries.some((e) => e.isIntersecting);
        inst.sync();
      })
      : null;
    if (io) io.observe(host);
    else inst.inView = true;

    instances.add(inst);
    inst.sync();

    return {
      setMood(mood) {
        inst.mood = mood === 'thinking' ? 'thinking' : 'idle';
        host.classList.toggle('ai-dot--thinking', inst.mood === 'thinking');
        if (reduceMq.matches) renderStatic();
        else inst.sync();
      },
      setExcited(on) {
        inst.excited = Boolean(on);
        host.classList.toggle('ai-dot--excited', inst.excited);
        inst.sync();
      },
      react(name) {
        const durations = { celebrate: 1700, wave: 1900, oops: 900 };
        if (!durations[name]) return;
        inst.reactName = name;
        inst.reactStart = performance.now();
        inst.reactDur = durations[name];
        host.classList.remove('ai-dot--celebrate', 'ai-dot--wave', 'ai-dot--oops');
        void host.offsetWidth; // reinicia la animación CSS del respaldo
        host.classList.add(`ai-dot--${name}`);
        clearTimeout(inst.reactTimer);
        inst.reactTimer = setTimeout(() => host.classList.remove(`ai-dot--${name}`), durations[name]);
        inst.sync();
      },
      setActive(on) {
        inst.active = Boolean(on);
        inst.sync();
      },
      destroy() {
        inst.destroyed = true;
        io?.disconnect();
        clearTimeout(inst.reactTimer);
        instances.delete(inst);
        disposeScene(inst.gl);
        inst.gl = null;
      },
      get is3d() { return Boolean(inst.gl); },
    };
  }

  global.addEventListener('pointermove', onPointer, { passive: true });
  doc.addEventListener('visibilitychange', syncAll);
  reduceMq.addEventListener?.('change', syncAll);

  global.AssistantMascot = { create, avatarSvg, svgMarkup, loadThree };
})(window);
