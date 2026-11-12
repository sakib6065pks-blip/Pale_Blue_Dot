/* Pale Blue Dot — interactive 3D Earth (three.js r128) */
(function () {
  "use strict";

  /* ---------- Where the textures come from ----------
     Each map tries its sources in order and uses the first one that loads:
       1. your own NASA downloads in ./textures/  (fastest, works offline)
       2. NASA GIBS live WMS (Blue Marble / Black Marble), straight from NASA
       3. three.js example textures on the CDN
       4. a procedural planet drawn in code (last resort)
     Note: opening index.html by double-click (file://) blocks local images;
     run a tiny server instead:  python3 -m http.server 8000  */
  const LOCAL = "textures/";
  const TEX_BASE =
    "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/";
  const MARS_BASE = "https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/";
  const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
  // Whole-globe equirectangular image from NASA GIBS (WMS 1.3.0 + EPSG:4326 means BBOX is lat,lon order)
  function gibs(layer, w, h, mime) {
    return GIBS_WMS + "?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=" + layer +
      "&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=" + w + "&HEIGHT=" + h +
      "&FORMAT=" + encodeURIComponent(mime);
  }
  const TEXTURES = {
    day: [LOCAL + "earth_day.jpg", gibs("BlueMarble_NextGeneration", 2048, 1024, "image/jpeg"), TEX_BASE + "earth_atmos_2048.jpg"],
    night: [LOCAL + "earth_night.jpg", gibs("VIIRS_Black_Marble", 2048, 1024, "image/jpeg"), TEX_BASE + "earth_lights_2048.png"],
    spec: [LOCAL + "earth_specular.jpg", TEX_BASE + "earth_specular_2048.jpg"],
    clouds: [LOCAL + "earth_clouds.png", TEX_BASE + "earth_clouds_1024.png"],
    moon: [LOCAL + "moon.jpg", TEX_BASE + "moon_1024.jpg"],
    mars: [LOCAL + "mars.jpg", MARS_BASE + "marsmap1k.jpg"],
    marsBump: [LOCAL + "mars_bump.jpg", MARS_BASE + "marsbump1k.jpg"],
  };

  const canvas = document.getElementById("scene");
  const loaderEl = document.getElementById("loader");
  const hintEl = document.getElementById("hint");

  /* ---------- Renderer / scene / camera ---------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    loaderEl.querySelector("p").textContent =
      "Your browser could not start WebGL, which this globe needs.";
    loaderEl.querySelector(".loader-ring").style.display = "none";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  const SUN_DIR = new THREE.Vector3(0.85, 0.25, 0.55).normalize();

  /* ---------- State ---------- */
  const START_ROT_Y = THREE.MathUtils.degToRad(-90 - 80); // face ~80°E
  const START_ROT_X = 0.38;
  const START_MARS_Y = 0.5;
  const MARS_TILT = 0.35;
  const state = {
    autoRotate: true,
    clouds: true,
    night: true,
    zoom: 1, // multiplier on base camera distance
    targetZoom: 1,
    velY: 0,
    velX: 0,
    dragging: false,
    resetting: false,
    intro: 0, // 0 → 1 camera dolly-in
    nightMix: 1,
    orbits: true,
    orbitMix: 1,
    iss: true,
    issMix: 0,
    view: "all", // "all" | "earth" | "moon"
    earthPresence: 1,
    camR: 3.25, // radius the camera must fit
    camD: 4.88, // minimum camera distance
    focus: new THREE.Vector3(),
    focusOff: new THREE.Vector3(), // focus minus its target; decays to 0 so the camera follows without lag
    camYaw: 0, // camera orbit around the focus (Moon view)
    camPitch: 0,
    marsPresence: 0,
    marsOrbitMix: 0,
    moonPresence: 1,
    shake: 0,
    city: null,
    fly: null,
    dest: "earth", // which body the rocket will fly to
    orbitSel: { earth: 0, moon: 0, mars: 0 }, // chosen orbit per body
  };

  /* ---------- Helpers ---------- */
  function baseDistance() {
    return Math.max(state.camD, state.camR / (TAN_HALF_FOV * camera.aspect));
  }

  // How far the camera needs to sit for each view
  function camTargets() {
    if (state.view === "moon") return { R: 0.95, D: 2.1 };
    if (state.view === "mars") return state.orbits ? { R: 2.3, D: 4.2 } : { R: 1.25, D: 2.9 };
    if (!state.orbits) return { R: 1.45, D: 3.7 };
    if (state.view === "earth") return { R: 2.6, D: 4.2 };
    return { R: 3.25, D: 4.88 };
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loadTexture(urls, timeoutMs) {
    const list = Array.isArray(urls) ? urls : [urls];
    const limit = timeoutMs || 8000;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    return new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (i >= list.length) { resolve(null); return; }
        const url = list[i++];
        let settled = false;
        let timer = null;
        const fail = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          tryNext();
        };
        timer = setTimeout(fail, limit);
        loader.load(
          url,
          (t) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            t.anisotropy = renderer.capabilities.getMaxAnisotropy();
            t.userData = t.userData || {};   // r128 textures have no userData by default
            t.userData.src = url;
            resolve(t);
          },
          undefined,
          fail
        );
      };
      tryNext();
    });
  }

  /* ---------- Procedural fallback (used only if textures fail to load) ---------- */
  function hash(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function vnoise(x, y, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const a = hash(x0, yi), b = hash(x1, yi);
    const c = hash(x0, yi + 1), d = hash(x1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function fbm(u, v, octaves) {
    let sum = 0, amp = 0.5, freq = 4, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * vnoise(u * freq, v * freq * 0.5, freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
  function makeFallbackTextures() {
    const W = 512, H = 256;
    const day = document.createElement("canvas");
    const spec = document.createElement("canvas");
    day.width = spec.width = W;
    day.height = spec.height = H;
    const dctx = day.getContext("2d"), sctx = spec.getContext("2d");
    const di = dctx.createImageData(W, H), si = sctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const lat = Math.abs(y / H - 0.5) * 2; // 0 equator → 1 pole
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        const h = fbm(u, v, 6) - lat * lat * 0.12;
        const i = (y * W + x) * 4;
        let r, g, b, s = 0;
        if (lat > 0.88 + (fbm(u + 3, v, 3) - 0.5) * 0.1) {
          r = 238; g = 244; b = 250;
        } else if (h > 0.5) {
          const e = Math.min((h - 0.5) / 0.2, 1);
          r = 58 + e * 100; g = 108 + e * 10; b = 52 + e * 40;
          if (lat < 0.35 && e < 0.7) { r += 30; g += 5; }
          if (e > 0.9) { r = g = b = 225; }
        } else {
          const d = Math.min((0.5 - h) / 0.2, 1);
          r = 22 - d * 14; g = 92 - d * 58; b = 150 - d * 70;
          s = 255;
        }
        di.data[i] = r; di.data[i + 1] = g; di.data[i + 2] = b; di.data[i + 3] = 255;
        si.data[i] = si.data[i + 1] = si.data[i + 2] = s; si.data[i + 3] = 255;
      }
    }
    dctx.putImageData(di, 0, 0);
    sctx.putImageData(si, 0, 0);

    const clouds = document.createElement("canvas");
    clouds.width = W; clouds.height = H;
    const cctx = clouds.getContext("2d");
    const ci = cctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = fbm(x / W + 7.3, y / H + 2.1, 6);
        const a = Math.max(0, Math.min(1, (n - 0.52) * 4.5));
        const i = (y * W + x) * 4;
        ci.data[i] = ci.data[i + 1] = ci.data[i + 2] = 255;
        ci.data[i + 3] = a * 255;
      }
    }
    cctx.putImageData(ci, 0, 0);

    const night = document.createElement("canvas");
    night.width = night.height = 4;
    night.getContext("2d").fillRect(0, 0, 4, 4);

    return {
      day: new THREE.CanvasTexture(day),
      spec: new THREE.CanvasTexture(spec),
      clouds: new THREE.CanvasTexture(clouds),
      night: new THREE.CanvasTexture(night),
    };
  }

  /* Does the cloud PNG carry real transparency, or is brightness the cloud amount? */
  function cloudsUseAlpha(tex) {
    try {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 32;
      const ctx = c.getContext("2d");
      ctx.drawImage(tex.image, 0, 0, 64, 32);
      const px = ctx.getImageData(0, 0, 64, 32).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return 1.0;
      return 0.0;
    } catch (e) {
      return 1.0;
    }
  }

  /* ---------- Shaders ---------- */
  const planetVert = `
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    void main() {
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const earthFrag = `
    uniform sampler2D dayMap;
    uniform sampler2D nightMap;
    uniform sampler2D specMap;
    uniform vec3 sunDir;
    uniform float uNight;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    void main() {
      vec3 n = normalize(vN);
      vec3 V = normalize(cameraPosition - vW);
      float sun = dot(n, sunDir);

      float lightD = mix(dot(n, V) * 0.75 + 0.25, sun, uNight);
      float dayMix = mix(1.0, smoothstep(-0.12, 0.22, sun), uNight);

      vec3 day = texture2D(dayMap, vUv).rgb;
      vec3 night = texture2D(nightMap, vUv).rgb;

      vec3 col = day * (0.07 + 1.1 * clamp(lightD, 0.0, 1.0));

      // warm sunset band along the terminator
      float tw = clamp(1.0 - abs(sun) * 3.6, 0.0, 1.0) * uNight;
      col = mix(col, col * vec3(1.35, 0.78, 0.58), tw * 0.65);

      // city lights on the dark side
      vec3 nightCol = night * vec3(1.0, 0.76, 0.42) * 1.7 + day * 0.014;
      col = mix(nightCol, col, dayMix);

      // sun glint on the oceans
      vec3 L = normalize(mix(normalize(V + vec3(-0.4, 0.5, 0.3)), sunDir, uNight));
      float spec = pow(max(dot(n, normalize(L + V)), 0.0), 70.0) * texture2D(specMap, vUv).r;
      col += vec3(0.6, 0.8, 1.0) * spec * 0.85 * dayMix;

      // soft blue limb
      float fr = pow(1.0 - max(dot(n, V), 0.0), 3.0);
      col += vec3(0.25, 0.55, 1.0) * fr * 0.6 * mix(1.0, clamp(sun + 0.4, 0.0, 1.0), uNight);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const cloudFrag = `
    uniform sampler2D cloudMap;
    uniform vec3 sunDir;
    uniform float uNight;
    uniform float uAlpha;
    uniform float uOpacity;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vW;
    void main() {
      vec3 n = normalize(vN);
      vec4 t = texture2D(cloudMap, vUv);
      float a = mix(t.r, t.a, uAlpha);
      float sun = dot(n, sunDir);
      float lit = mix(0.85, smoothstep(-0.15, 0.35, sun) * 0.95 + 0.04, uNight);
      vec3 col = vec3(1.0) * lit;
      col = mix(col, col * vec3(1.3, 0.8, 0.6), clamp(1.0 - abs(sun) * 4.0, 0.0, 1.0) * uNight * 0.6);
      gl_FragColor = vec4(col, a * 0.88 * uOpacity);
    }
  `;

  const atmoVert = `
    varying vec3 vNView;
    varying vec3 vNWorld;
    void main() {
      vNView = normalize(normalMatrix * normal);
      vNWorld = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const atmoFrag = `
    uniform vec3 sunDir;
    uniform float uNight;
    varying vec3 vNView;
    varying vec3 vNWorld;
    void main() {
      float d = -dot(normalize(vNView), vec3(0.0, 0.0, 1.0));
      float glow = pow(clamp(d / 0.55, 0.0, 1.0), 2.4);
      float sunSide = mix(1.0, clamp(dot(normalize(vNWorld), sunDir) + 0.5, 0.0, 1.0), uNight);
      vec3 col = mix(vec3(0.12, 0.42, 1.0), vec3(0.55, 0.82, 1.0), glow);
      gl_FragColor = vec4(col * glow * sunSide * 1.5, 1.0);
    }
  `;

  /* ---------- Build the world ---------- */
  const earthGroup = new THREE.Group();
  scene.add(earthGroup);
  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);
  const marsGroup = new THREE.Group();
  const marsOrbitGroup = new THREE.Group();
  marsGroup.visible = marsOrbitGroup.visible = false;
  scene.add(marsGroup, marsOrbitGroup);

  let earthMat, cloudMat, atmoMat, cloudMesh;
  let atmoMesh = null, moonMesh = null, moonRing = null, moonTrailLine = null, marsAtmoMesh = null, moonPivotRef = null;
  const earthPivots = [];

  function buildStars() {
    const count = 5000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 60 + Math.random() * 60;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const k = Math.random();
      if (k < 0.15) tmp.setRGB(1.0, 0.82, 0.65);
      else if (k < 0.35) tmp.setRGB(0.7, 0.82, 1.0);
      else tmp.setRGB(1, 1, 1);
      tmp.multiplyScalar(0.35 + Math.random() * 0.65);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

    // soft round sprite
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);

    const mat = new THREE.PointsMaterial({
      size: 0.55,
      map: new THREE.CanvasTexture(c),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(geo, mat);
    scene.add(stars);
    return stars;
  }

  let stars;

  async function init() {
    resize();
    stars = buildStars();

    const [day, night, spec, clouds, moonTex, marsTex, marsBump] = await Promise.all([
      loadTexture(TEXTURES.day),
      loadTexture(TEXTURES.night),
      loadTexture(TEXTURES.spec),
      loadTexture(TEXTURES.clouds),
      loadTexture(TEXTURES.moon),
      loadTexture(TEXTURES.mars),
      loadTexture(TEXTURES.marsBump),
    ]);

    // If the real photos are unavailable (offline, blocked), fall back to a procedural planet.
    let T = { day, night, spec, clouds };
    if (!day || !spec) {
      const fb = makeFallbackTextures();
      T = { day: fb.day, night: night || fb.night, spec: fb.spec, clouds: clouds || fb.clouds };
      if (!clouds) T.clouds = fb.clouds;
    }
    if (!T.night) T.night = makeFallbackTextures().night;
    if (!T.clouds) T.clouds = makeFallbackTextures().clouds;

    const SEG = 128;

    // Earth
    earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: T.day },
        nightMap: { value: T.night },
        specMap: { value: T.spec },
        sunDir: { value: SUN_DIR },
        uNight: { value: 1.0 },
      },
      vertexShader: planetVert,
      fragmentShader: earthFrag,
    });
    earthGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1, SEG, SEG), earthMat));

    // Clouds
    cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        cloudMap: { value: T.clouds },
        sunDir: { value: SUN_DIR },
        uNight: { value: 1.0 },
        uAlpha: { value: day ? cloudsUseAlpha(T.clouds) : 1.0 },
        uOpacity: { value: 1.0 },
      },
      vertexShader: planetVert,
      fragmentShader: cloudFrag,
      transparent: true,
      depthWrite: false,
    });
    cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.012, SEG, SEG), cloudMat);
    earthGroup.add(cloudMesh);

    // Atmosphere (not part of the spinning group — it's a view-dependent halo)
    atmoMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: SUN_DIR }, uNight: { value: 1.0 } },
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(1.2, 96, 96), atmoMat);
    scene.add(atmoMesh);

    earthGroup.rotation.set(START_ROT_X, START_ROT_Y, 0);
    orbitGroup.rotation.set(START_ROT_X, 0, 0);
    buildMarkers();
    try { buildIss(); } catch (e) { console.error("ISS tracker failed to start:", e); }
    buildOrbits(moonTex);
    buildMars(marsTex, marsBump);

    try { setCredit([day, night, spec, clouds, moonTex, marsTex, marsBump]); } catch (e) { console.error(e); }
    loaderEl.classList.add("done");
    requestAnimationFrame(tick);
  }

  /* ---------- Orbits, satellites, Moon ---------- */
  const orbitBodies = [];
  const followers = []; // groups that ride along with another object (e.g. the Moon's system)
  const labels = [];
  const labelsEl = document.getElementById("labels");
  const rad = THREE.MathUtils.degToRad;

  // Every orbit a rocket can be sent to; filled in as the rings are built
  const ORBIT_OPTIONS = { earth: [], moon: [], mars: [] };
  function registerOrbit(body, d, pivot, ring, baseOpacity) {
    ORBIT_OPTIONS[body].push({
      chip: d.chip, title: d.title, desc: d.desc, radius: d.radius, speed: d.speed,
      color: d.color, pivot, ring, baseOpacity,
    });
  }

  function makeGlowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function makeSatellite(color, glowTex) {
    const sat = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.85, roughness: 0.35 })
    );
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x2a5cff, metalness: 0.6, roughness: 0.3, emissive: 0x0a1a55,
    });
    const panelGeo = new THREE.BoxGeometry(0.13, 0.004, 0.055);
    const left = new THREE.Mesh(panelGeo, panelMat);
    const right = new THREE.Mesh(panelGeo, panelMat);
    left.position.x = -0.1;
    right.position.x = 0.1;
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    halo.scale.setScalar(0.28);
    sat.add(body, left, right, halo);
    return sat;
  }

  function makeTrail(color, length) {
    const pos = new Float32Array(length * 3);
    const col = new Float32Array(length * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < length; i++) {
      const f = Math.pow(1 - i / length, 1.6);
      col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    line.frustumCulled = false;
    return { line, pos, geo, length };
  }

  function addLabel(text, obj, yOffset, mixKey) {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = text;
    labelsEl.appendChild(el);
    labels.push({ el, obj, yOffset: yOffset || 0, mixKey: mixKey || "orbitMix" });
  }

  function makeRing(radius, color, opacity) {
    const pts = [];
    for (let i = 0; i < 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    );
  }

  function buildOrbits(moonTex) {
    // Lights for the satellites and the Moon (the planet shader lights itself)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.copy(SUN_DIR).multiplyScalar(10);
    scene.add(sun, new THREE.AmbientLight(0x6f86b8, 0.55));

    const glowTex = makeGlowTexture();
    const defs = [
      { name: "ISS", chip: "ISS", title: "ISS orbit", desc: "Low Earth orbit, tilted 51.6°.", radius: 1.32, incl: 51.6, node: 25, speed: 0.55, color: 0x7fd0ff, sats: 1 },
      { name: "Polar satellites", chip: "Polar", title: "Polar orbit", desc: "Passes over both poles, scanning the whole planet.", radius: 1.58, incl: 90, node: 70, speed: 0.38, color: 0xffb86b, sats: 2 },
      { name: "GPS", chip: "GPS", title: "GPS orbit", desc: "Medium Earth orbit, tilted 55°.", radius: 1.95, incl: 55, node: 150, speed: 0.2, color: 0x9dffb0, sats: 3 },
      { name: "Geostationary", chip: "Geostationary", title: "Geostationary orbit", desc: "High above the equator, over one spot on the ground.", radius: 2.3, incl: 0, node: 0, speed: 0.09, color: 0xff8fd0, sats: 1 },
    ];

    defs.forEach((d) => {
      const pivot = new THREE.Group();
      pivot.rotation.order = "YXZ";
      pivot.rotation.x = rad(d.incl);
      pivot.rotation.y = rad(d.node);
      const ring = makeRing(d.radius, d.color, 0.32);
      pivot.add(ring);
      earthPivots.push(pivot);
      registerOrbit("earth", d, pivot, ring, 0.32);

      for (let i = 0; i < d.sats; i++) {
        const obj = makeSatellite(d.color, glowTex);
        const trail = makeTrail(d.color, 56);
        pivot.add(trail.line, obj);
        orbitBodies.push({
          obj, trail, radius: d.radius, speed: d.speed,
          angle: (i / d.sats) * Math.PI * 2 + d.node, step: 0.032, lockFace: false,
        });
        if (i === 0) addLabel(d.name, obj, 0);
      }
      orbitGroup.add(pivot);
    });

    // The Moon (size relative to Earth is true; its distance is shortened to fit the screen)
    const moonPivot = new THREE.Group();
    moonPivot.rotation.order = "YXZ";
    moonPivot.rotation.x = rad(5.1);
    moonPivot.rotation.y = rad(-30);
    moonRing = makeRing(2.95, 0xc9d6f5, 0.5);
    moonPivot.add(moonRing);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 64, 64),
      new THREE.MeshStandardMaterial(
        moonTex ? { map: moonTex, roughness: 1, metalness: 0 } : { color: 0xb9b9b9, roughness: 1, metalness: 0 }
      )
    );
    const moonTrail = makeTrail(0xc9d6f5, 140);
    moonPivot.add(moonTrail.line, moon);
    moonMesh = moon;
    moonTrailLine = moonTrail.line;
    orbitBodies.push({
      obj: moon, trail: moonTrail, radius: 2.95, speed: 0.06,
      angle: 1.2, step: 0.018, lockFace: true,
    });
    addLabel("Moon", moon, 0.32);

    // Orbits around the Moon itself: small orbiters on their own tilted rings
    const moonSystem = new THREE.Group();
    moonPivot.add(moonSystem);
    followers.push({ group: moonSystem, target: moon });
    const lunarDefs = [
      { name: "Lunar orbiter", chip: "Polar", title: "Lunar polar orbit", desc: "Near-polar orbit close above the Moon.", radius: 0.46, incl: 80, node: 20, speed: 1.5, color: 0xffd27f, sats: 1 },
      { name: "Lunar relay", chip: "Relay", title: "Lunar relay orbit", desc: "Higher orbit tilted 35°, used for relaying signals.", radius: 0.62, incl: 35, node: 140, speed: 1.0, color: 0x8fe3ff, sats: 2 },
    ];
    lunarDefs.forEach((d) => {
      const sub = new THREE.Group();
      sub.rotation.order = "YXZ";
      sub.rotation.x = rad(d.incl);
      sub.rotation.y = rad(d.node);
      const ring = makeRing(d.radius, d.color, 0.45);
      sub.add(ring);
      registerOrbit("moon", d, sub, ring, 0.45);
      for (let i = 0; i < d.sats; i++) {
        const obj = makeSatellite(d.color, glowTex);
        obj.scale.setScalar(0.5);
        const trail = makeTrail(d.color, 40);
        sub.add(trail.line, obj);
        orbitBodies.push({
          obj, trail, radius: d.radius, speed: d.speed,
          angle: (i / d.sats) * Math.PI * 2 + d.node, step: 0.1, lockFace: false,
        });
        if (i === 0) addLabel(d.name, obj, 0);
      }
      moonSystem.add(sub);
    });

    orbitGroup.add(moonPivot);
    moonPivotRef = moonPivot;
  }

  function updateOrbits(dt) {
    const k = reduceMotion ? 0 : dt;
    for (const b of orbitBodies) {
      b.angle += b.speed * k;
      b.obj.position.set(Math.cos(b.angle) * b.radius, 0, Math.sin(b.angle) * b.radius);
      b.obj.rotation.y = b.lockFace ? -b.angle + Math.PI : -b.angle;
      const t = b.trail;
      for (let i = 0; i < t.length; i++) {
        const a = b.angle - i * b.step;
        t.pos[i * 3] = Math.cos(a) * b.radius;
        t.pos[i * 3 + 1] = 0;
        t.pos[i * 3 + 2] = Math.sin(a) * b.radius;
      }
      t.geo.attributes.position.needsUpdate = true;
    }
    for (const f of followers) f.group.position.copy(f.target.position);
  }

  const _v = new THREE.Vector3();
  const _moonPos = new THREE.Vector3();
  const _zero = new THREE.Vector3();
  const _ft = new THREE.Vector3();
  function getFocusTarget(view, out) {
    if (view === "moon" && moonMesh) return moonMesh.getWorldPosition(out);
    return out.set(0, 0, 0);
  }
  function deepVisible(o) {
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  }
  function updateLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    const cam = camera.position;
    camera.updateMatrixWorld();
    for (const l of labels) {
      l.obj.getWorldPosition(_v);
      // hide when the planet is in the way
      const dx = _v.x - cam.x, dy = _v.y - cam.y, dz = _v.z - cam.z;
      const len2 = dx * dx + dy * dy + dz * dz;
      const t = Math.max(0, Math.min(1, -(cam.x * dx + cam.y * dy + cam.z * dz) / len2));
      const cx = cam.x + dx * t, cy = cam.y + dy * t, cz = cam.z + dz * t;
      const inMars = state.view === "mars";
      const occR = inMars ? 0.83 : 1.03;
      const occP = inMars ? state.marsPresence : state.earthPresence;
      const blocked = occP > 0.5 && Math.sqrt(cx * cx + cy * cy + cz * cz) < occR && t < 1;
      const mix = state[l.mixKey];
      const hidden = blocked || !deepVisible(l.obj);
      _v.y += l.yOffset * mix;
      _v.project(camera);
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      l.el.style.transform = "translate(" + (x + 12).toFixed(1) + "px," + (y - 26).toFixed(1) + "px)";
      l.el.style.opacity = hidden || mix < 0.6 ? 0 : (mix - 0.6) / 0.4;
    }
  }

  /* ---------- Mars ---------- */
  function makeFallbackMars() {
    const W = 512, H = 256;
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      return { c, ctx, img: ctx.createImageData(W, H) };
    };
    const col = mk(), bmp = mk();
    for (let y = 0; y < H; y++) {
      const lat = Math.abs(y / H - 0.5) * 2;
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        const n = fbm(u + 11.7, v + 4.2, 6);
        const m = fbm(u + 2.9, v + 8.8, 4);
        let r = 140 + n * 70, g = 66 + n * 62, b = 38 + n * 44;
        const dk = Math.max(0, Math.min(1, (m - 0.56) * 7));
        r += (84 - r) * dk; g += (46 - g) * dk; b += (36 - b) * dk;
        if (lat > 0.9) { r = 240; g = 236; b = 230; }
        const i = (y * W + x) * 4;
        col.img.data[i] = r; col.img.data[i + 1] = g; col.img.data[i + 2] = b; col.img.data[i + 3] = 255;
        const h = n * 255;
        bmp.img.data[i] = bmp.img.data[i + 1] = bmp.img.data[i + 2] = h; bmp.img.data[i + 3] = 255;
      }
    }
    col.ctx.putImageData(col.img, 0, 0);
    bmp.ctx.putImageData(bmp.img, 0, 0);
    return { map: new THREE.CanvasTexture(col.c), bump: new THREE.CanvasTexture(bmp.c) };
  }

  // A lumpy little rock for Phobos / Deimos
  function makeRockMoon(r, seed) {
    const g = new THREE.IcosahedronGeometry(r, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / r, y = p.getY(i) / r, z = p.getZ(i) / r;
      const k = 1 + 0.16 * Math.sin(x * 7 + seed) * Math.cos(y * 6 + seed * 2) + 0.1 * Math.sin(z * 9 + seed * 3);
      p.setXYZ(i, x * r * k, y * r * k, z * r * k);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9a8873, roughness: 1, metalness: 0 }));
    m.scale.set(1.25, 0.9, 1);
    return m;
  }

  function buildMars(tex, bump) {
    const fb = tex ? null : makeFallbackMars();
    const marsMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 128, 128),
      new THREE.MeshStandardMaterial({
        map: tex || fb.map,
        bumpMap: tex ? bump || null : fb.bump,
        bumpScale: 0.05,
        roughness: 1,
        metalness: 0,
      })
    );
    marsGroup.add(marsMesh);

    // Thin, dusty butterscotch atmosphere
    const marsAtmoFrag = atmoFrag
      .replace("vec3(0.12, 0.42, 1.0)", "vec3(0.85, 0.34, 0.14)")
      .replace("vec3(0.55, 0.82, 1.0)", "vec3(1.0, 0.72, 0.46)")
      .replace("* 1.5,", "* 0.95,");
    marsAtmoMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.96, 96, 96),
      new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: SUN_DIR }, uNight: { value: 1.0 } },
        vertexShader: atmoVert,
        fragmentShader: marsAtmoFrag,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })
    );
    marsAtmoMesh.visible = false;
    scene.add(marsAtmoMesh);

    marsGroup.rotation.set(MARS_TILT, START_MARS_Y, 0);
    marsOrbitGroup.rotation.set(MARS_TILT, 0, 0);
    addLabel("Mars", marsMesh, 0.95, "marsPresence");

    const glowTex = makeGlowTexture();
    const defs = [
      { name: "Mars orbiter", chip: "Polar", title: "Mars polar orbit", desc: "Low, near-polar orbit that sweeps over the whole surface.", radius: 1.05, incl: 93, node: 20, speed: 0.8, color: 0xffd27f, sats: 1 },
      { name: "Relay", chip: "Relay", title: "Mars relay orbit", desc: "Higher orbit tilted 40°, used for relaying signals.", radius: 1.6, incl: 40, node: 150, speed: 0.5, color: 0x8fe3ff, sats: 2 },
    ];
    defs.forEach((d) => {
      const pivot = new THREE.Group();
      pivot.rotation.order = "YXZ";
      pivot.rotation.x = rad(d.incl);
      pivot.rotation.y = rad(d.node);
      const ring = makeRing(d.radius, d.color, 0.4);
      pivot.add(ring);
      registerOrbit("mars", d, pivot, ring, 0.4);
      for (let i = 0; i < d.sats; i++) {
        const obj = makeSatellite(d.color, glowTex);
        obj.scale.setScalar(0.55);
        const trail = makeTrail(d.color, 44);
        pivot.add(trail.line, obj);
        orbitBodies.push({
          obj, trail, radius: d.radius, speed: d.speed,
          angle: (i / d.sats) * Math.PI * 2 + d.node, step: 0.08, lockFace: false,
        });
        if (i === 0) addLabel(d.name, obj, 0, "marsOrbitMix");
      }
      marsOrbitGroup.add(pivot);
    });

    // Mars's two real moons
    const moons = [
      { name: "Phobos", chip: "Phobos", title: "Phobos orbit", desc: "Share the path of Phobos, Mars's inner moon.", radius: 1.3, incl: 1, node: 60, speed: 0.7, size: 0.07, seed: 1, color: 0xb8a58f },
      { name: "Deimos", chip: "Deimos", title: "Deimos orbit", desc: "Share the path of Deimos, Mars's outer moon.", radius: 1.95, incl: 2, node: 200, speed: 0.4, size: 0.05, seed: 5, color: 0xb8a58f },
    ];
    moons.forEach((d) => {
      const pivot = new THREE.Group();
      pivot.rotation.order = "YXZ";
      pivot.rotation.x = rad(d.incl);
      pivot.rotation.y = rad(d.node);
      const ring = makeRing(d.radius, d.color, 0.35);
      pivot.add(ring);
      registerOrbit("mars", d, pivot, ring, 0.35);
      const rock = makeRockMoon(d.size, d.seed);
      const trail = makeTrail(0xb8a58f, 50);
      pivot.add(trail.line, rock);
      orbitBodies.push({
        obj: rock, trail, radius: d.radius, speed: d.speed,
        angle: d.node, step: 0.05, lockFace: true,
      });
      addLabel(d.name, rock, 0.06, "marsOrbitMix");
      marsOrbitGroup.add(pivot);
    });
  }

  /* Apply a drag/inertia rotation to whatever is on show */
  function rotateBy(dY, dX) {
    if (state.view === "moon") {
      // Orbit the camera around the Moon; nothing in the scene moves, so it stays smooth
      state.camYaw -= dY;
      state.camPitch = THREE.MathUtils.clamp(state.camPitch + dX, -1.3, 1.3);
      return;
    }
    if (state.view === "mars") {
      marsGroup.rotation.y += dY;
      marsGroup.rotation.x = THREE.MathUtils.clamp(marsGroup.rotation.x + dX, -1.2, 1.2);
      marsOrbitGroup.rotation.y += dY;
      marsOrbitGroup.rotation.x = THREE.MathUtils.clamp(marsOrbitGroup.rotation.x + dX, -1.2, 1.2);
      return;
    }
    earthGroup.rotation.y += dY;
    earthGroup.rotation.x = THREE.MathUtils.clamp(earthGroup.rotation.x + dX, -1.2, 1.2);
    orbitGroup.rotation.y += dY;
    orbitGroup.rotation.x = THREE.MathUtils.clamp(orbitGroup.rotation.x + dX, -1.2, 1.2);
  }

  /* ---------- Cities: tiny dots on the globe ---------- */
  const CITIES = ("Dhaka|Bangladesh|23.81|90.41;Delhi|India|28.61|77.21;Mumbai|India|19.08|72.88;Kolkata|India|22.57|88.36;Karachi|Pakistan|24.86|67.00;Lahore|Pakistan|31.52|74.36;Kathmandu|Nepal|27.72|85.32;Colombo|Sri Lanka|6.93|79.86;Bangkok|Thailand|13.76|100.50;Singapore|Singapore|1.35|103.82;Kuala Lumpur|Malaysia|3.14|101.69;Jakarta|Indonesia|-6.21|106.85;Manila|Philippines|14.60|120.98;Hanoi|Vietnam|21.03|105.85;Hong Kong|China|22.32|114.17;Shanghai|China|31.23|121.47;Beijing|China|39.90|116.41;Seoul|South Korea|37.57|126.98;Tokyo|Japan|35.68|139.65;Dubai|UAE|25.20|55.27;Riyadh|Saudi Arabia|24.71|46.68;Tehran|Iran|35.69|51.39;Istanbul|Türkiye|41.01|28.98;London|UK|51.51|-0.13;Paris|France|48.86|2.35;Madrid|Spain|40.42|-3.70;Rome|Italy|41.90|12.50;Berlin|Germany|52.52|13.40;Amsterdam|Netherlands|52.37|4.90;Stockholm|Sweden|59.33|18.07;Moscow|Russia|55.76|37.62;Athens|Greece|37.98|23.73;Reykjavik|Iceland|64.15|-21.94;Cairo|Egypt|30.04|31.24;Lagos|Nigeria|6.52|3.38;Nairobi|Kenya|-1.29|36.82;Addis Ababa|Ethiopia|9.03|38.74;Johannesburg|South Africa|-26.20|28.05;Cape Town|South Africa|-33.92|18.42;Casablanca|Morocco|33.57|-7.59;New York|USA|40.71|-74.01;Washington DC|USA|38.91|-77.04;Miami|USA|25.76|-80.19;Chicago|USA|41.88|-87.63;Los Angeles|USA|34.05|-118.24;San Francisco|USA|37.77|-122.42;Honolulu|USA|21.31|-157.86;Toronto|Canada|43.65|-79.38;Vancouver|Canada|49.28|-123.12;Mexico City|Mexico|19.43|-99.13;Bogotá|Colombia|4.71|-74.07;Lima|Peru|-12.05|-77.04;Santiago|Chile|-33.45|-70.67;Buenos Aires|Argentina|-34.60|-58.38;São Paulo|Brazil|-23.55|-46.63;Rio de Janeiro|Brazil|-22.91|-43.17;Sydney|Australia|-33.87|151.21;Melbourne|Australia|-37.81|144.96;Auckland|New Zealand|-36.85|174.76").split(";").map((s) => {
    const [name, country, la, lo] = s.split("|");
    const lat = +la, lon = +lo, p = rad(lat), l = rad(lon);
    return {
      name, country, lat, lon, label: name + ", " + country,
      vec: new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l)),
    };
  });

  const $ = (id) => document.getElementById(id);
  const cityPanel = $("city-panel"), cityInput = $("city-input"), cityCard = $("city-card");
  let rocket = null, rocketTrail = null;
  const _w = new THREE.Vector3(), _c = new THREE.Vector3();

  function dotTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.strokeStyle = "rgba(4,10,24,0.8)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(16, 16, 11, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    return new THREE.CanvasTexture(c);
  }
  function buildMarkers() {
    const tex = dotTexture();
    const pos = new Float32Array(CITIES.length * 3);
    CITIES.forEach((c, i) => c.vec.clone().multiplyScalar(1.002).toArray(pos, i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dots = new THREE.Points(g, new THREE.PointsMaterial({
      map: tex, size: 5, sizeAttenuation: false, color: 0xffd98f, transparent: true, depthWrite: false,
    }));
    dots.renderOrder = 10;
    earthGroup.add(dots);

    // The rocket that stands on the selected city
    rocket = makeRocket();
    rocket.visible = false;
    earthGroup.add(rocket);
    rocketTrail = makeRocketTrail();
    scene.add(rocketTrail.obj);
  }

  /* ---------- The rocket ---------- */
  const ROCKET_H = 0.215; // height of the model
  const PAD_SCALE = 0.85; // size while standing on the launch pad
  const PAD_H = ROCKET_H * 0.5 * PAD_SCALE; // height of the rocket's centre above the ground on the pad
  const DEST_SCALE = { earth: 0.8, moon: 0.5, mars: 0.55 }; // it shrinks to suit the body it orbits
  const TRAIL_N = 90;

  function makeRocket() {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.y = -ROCKET_H / 2; // root's origin is the middle of the rocket
    root.add(inner);

    const white = new THREE.MeshStandardMaterial({ color: 0xf2f5fb, metalness: 0.25, roughness: 0.32 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe5432f, metalness: 0.3, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.8, roughness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x59b8ff, metalness: 0.2, roughness: 0.1, emissive: 0x0f4a8a, emissiveIntensity: 0.9,
    });
    const part = (geo, mat, y) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      inner.add(m);
      return m;
    };

    part(new THREE.CylinderGeometry(0.018, 0.028, 0.034, 20), dark, 0.017); // engine bell
    part(new THREE.CylinderGeometry(0.034, 0.036, 0.115, 28), white, 0.0915); // body
    part(new THREE.CylinderGeometry(0.0358, 0.0358, 0.012, 28), red, 0.065); // stripe
    part(new THREE.CylinderGeometry(0.0347, 0.0347, 0.006, 28), red, 0.135); // thin stripe
    part(new THREE.ConeGeometry(0.034, 0.066, 28), red, 0.182); // nose cone

    // Porthole
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0032, 12, 28), dark);
    frame.position.set(0, 0.112, 0.0346);
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 20, 14), glass);
    win.scale.z = 0.35;
    win.position.set(0, 0.112, 0.0346);
    inner.add(frame, win);

    // Three swept fins
    const fs = new THREE.Shape();
    fs.moveTo(0.03, 0.098);
    fs.lineTo(0.08, 0.016);
    fs.lineTo(0.08, 0.0);
    fs.lineTo(0.03, 0.016);
    fs.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fs, { depth: 0.007, bevelEnabled: false });
    finGeo.translate(0, 0, -0.0035);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(finGeo, red);
      f.rotation.y = -(Math.PI / 6 + (i * 2 * Math.PI) / 3);
      inner.add(f);
    }

    // Exhaust flame (only shown in flight)
    const flame = new THREE.Group();
    const outerGeo = new THREE.ConeGeometry(0.022, 0.13, 20, 1, true);
    outerGeo.rotateX(Math.PI);
    outerGeo.translate(0, -0.065, 0);
    const coreGeo = new THREE.ConeGeometry(0.012, 0.085, 16, 1, true);
    coreGeo.rotateX(Math.PI);
    coreGeo.translate(0, -0.0425, 0);
    const flameMat = (color, opacity) =>
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
    const outerFlame = new THREE.Mesh(outerGeo, flameMat(0xff7a22, 0.8));
    const coreFlame = new THREE.Mesh(coreGeo, flameMat(0xffe9a8, 0.95));
    outerFlame.renderOrder = coreFlame.renderOrder = 13;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(), color: 0xff9a3c, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    glow.scale.setScalar(0.2);
    glow.position.y = -0.03;
    glow.renderOrder = 13;
    flame.add(outerFlame, coreFlame, glow);
    flame.visible = false;
    inner.add(flame);

    // Glowing ring on the ground while the rocket waits on the pad
    const padGeo = new THREE.RingGeometry(0.055, 0.072, 48);
    padGeo.rotateX(-Math.PI / 2);
    const pad = new THREE.Mesh(
      padGeo,
      new THREE.MeshBasicMaterial({
        color: 0x4aa3ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    pad.position.y = 0.002;
    pad.renderOrder = 12;
    inner.add(pad);

    root.userData = { flame, pad };
    return root;
  }

  // Glowing exhaust trail, kept in world space
  function makeRocketTrail() {
    const pos = new Float32Array(TRAIL_N * 3);
    const col = new Float32Array(TRAIL_N * 3);
    for (let i = 0; i < TRAIL_N; i++) {
      const f = Math.pow(1 - i / TRAIL_N, 1.7);
      col[i * 3] = f;
      col[i * 3 + 1] = (0.5 + 0.4 * (1 - i / TRAIL_N)) * f;
      col[i * 3 + 2] = 0.18 * f;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const common = { vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial(common));
    const puffs = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ ...common, map: makeGlowTexture(), size: 8, sizeAttenuation: false })
    );
    line.frustumCulled = puffs.frustumCulled = false;
    line.renderOrder = puffs.renderOrder = 12;
    const obj = new THREE.Group();
    obj.add(line, puffs);
    obj.visible = false;
    return { obj, pos, geo };
  }
  function resetTrail(p) {
    const a = rocketTrail.pos;
    for (let i = 0; i < TRAIL_N; i++) {
      a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
    }
    rocketTrail.geo.attributes.position.needsUpdate = true;
  }
  function pushTrail(p) {
    const a = rocketTrail.pos;
    a.copyWithin(3, 0, (TRAIL_N - 1) * 3);
    a[0] = p.x; a[1] = p.y; a[2] = p.z;
    rocketTrail.geo.attributes.position.needsUpdate = true;
  }

  // Stand the rocket upright on a city
  function placeRocket(c) {
    if (!rocket) return;
    earthGroup.add(rocket);
    rocket.scale.setScalar(PAD_SCALE);
    rocket.position.copy(c.vec).multiplyScalar(1 + PAD_H);
    rocket.quaternion.setFromUnitVectors(_Y, c.vec);
    rocket.userData.pad.visible = true;
    rocket.userData.flame.visible = false;
    rocket.visible = true;
  }

  function pickAt(px, py, r) {
    if (!(state.view === "all" || state.view === "earth") || state.earthPresence < 0.9) return;
    camera.updateMatrixWorld();
    let best = null, bd = r * r;
    for (const c of CITIES) {
      _w.copy(c.vec).applyMatrix4(earthGroup.matrixWorld);
      if (_c.copy(camera.position).sub(_w).dot(_w) <= 0) continue; // far side of the globe
      _w.project(camera);
      const dx = (_w.x * 0.5 + 0.5) * window.innerWidth - px;
      const dy = (-_w.y * 0.5 + 0.5) * window.innerHeight - py;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) selectCity(best);
  }

  function selectCity(c) {
    endTrip(false);
    if (state.view !== "all" && state.view !== "earth") setView("earth");
    state.city = c;
    // Turn the globe so the dot faces you (no zoom)
    state.fly = { y: -Math.PI / 2 - rad(c.lon), x: THREE.MathUtils.clamp(rad(c.lat), -1.2, 1.2) };
    state.velX = state.velY = 0;
    state.resetting = false;
    placeRocket(c);
    cityInput.value = c.label;
    closeList();
    if (document.activeElement === cityInput) cityInput.blur();
    $("city-name").textContent = c.name;
    $("city-meta").textContent = c.country + " · " + Math.abs(c.lat).toFixed(2) + "°" + (c.lat < 0 ? "S" : "N") +
      " " + Math.abs(c.lon).toFixed(2) + "°" + (c.lon < 0 ? "W" : "E");
    cityCard.hidden = false;
    renderOrbitChoices();
  }
  function clearCity() {
    endTrip(false);
    state.city = null;
    state.fly = null;
    if (rocket) rocket.visible = false;
    cityCard.hidden = true;
    cityInput.value = "";
    hideReport();
    closeList();
    syncPanel();
    updateLaunchState();
  }

  /* ---------- City search: custom dropdown ---------- */
  const cityList = $("city-results");
  let shown = [], active = -1;

  function highlight(el, text, q) {
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) { el.textContent = text; return; }
    el.append(text.slice(0, i));
    const m = document.createElement("mark");
    m.textContent = text.slice(i, i + q.length);
    el.append(m, text.slice(i + q.length));
  }
  function filterCities(q) {
    q = q.trim().toLowerCase();
    if (!q) return CITIES.slice();
    const rank = (c) => {
      const n = c.name.toLowerCase(), k = c.country.toLowerCase();
      if (n.startsWith(q)) return 0;
      if (n.includes(q)) return 1;
      if (k.startsWith(q)) return 2;
      if (k.includes(q)) return 3;
      return -1;
    };
    return CITIES.map((c) => [c, rank(c)]).filter((x) => x[1] >= 0).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }
  function setActive(i, scroll) {
    const items = cityList.children;
    if (active >= 0 && items[active]) items[active].classList.remove("is-active");
    active = i;
    if (i >= 0 && items[i]) {
      items[i].classList.add("is-active");
      cityInput.setAttribute("aria-activedescendant", items[i].id);
      if (scroll) items[i].scrollIntoView({ block: "nearest" });
    } else cityInput.removeAttribute("aria-activedescendant");
  }
  function renderCities() {
    const q = cityInput.value.trim().toLowerCase();
    // After picking a city the box shows its full label; show everything again in that case
    const exact = state.city && cityInput.value === state.city.label;
    const query = exact ? "" : q;
    shown = filterCities(query);
    cityList.textContent = "";
    if (!shown.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No matching city";
      cityList.appendChild(li);
      setActive(-1);
      return;
    }
    shown.forEach((c, i) => {
      const li = document.createElement("li");
      li.id = "city-opt-" + i;
      li.setAttribute("role", "option");
      const isCur = state.city === c;
      li.setAttribute("aria-selected", String(isCur));
      if (isCur) li.classList.add("is-current");
      const n = document.createElement("span");
      n.className = "opt-name";
      highlight(n, c.name, query);
      const k = document.createElement("span");
      k.className = "opt-country";
      highlight(k, c.country, query);
      li.append(n, k);
      li.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener("click", () => selectCity(c));
      li.addEventListener("mousemove", () => { if (active !== i) setActive(i, false); });
      cityList.appendChild(li);
    });
    const cur = shown.indexOf(state.city);
    setActive(query ? 0 : cur, true);
    if (!query && cur < 0) cityList.scrollTop = 0;
  }
  function openList() {
    renderCities();
    cityList.hidden = false;
    cityInput.setAttribute("aria-expanded", "true");
  }
  function closeList() {
    cityList.hidden = true;
    cityInput.setAttribute("aria-expanded", "false");
    cityInput.removeAttribute("aria-activedescendant");
  }
  cityInput.addEventListener("focus", () => { openList(); cityInput.select(); });
  cityInput.addEventListener("click", () => { if (cityList.hidden) openList(); });
  cityInput.addEventListener("input", () => { if (cityList.hidden) openList(); else renderCities(); });
  cityInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (cityList.hidden) { openList(); return; }
      if (!shown.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((active + d + shown.length) % shown.length, true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = shown[active] || findCity(cityInput.value);
      if (c) selectCity(c);
    } else if (e.key === "Escape") {
      closeList();
    } else if (e.key === "Tab") {
      closeList();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!cityList.hidden && !e.target.closest(".picker")) closeList();
  });
  const findCity = (q) => {
    q = q.trim().toLowerCase();
    return q ? CITIES.find((c) => c.label.toLowerCase() === q) || CITIES.find((c) => c.label.toLowerCase().includes(q)) : null;
  };
  $("btn-city-clear").addEventListener("click", clearCity);

  /* ---------- Pick an orbit, then fly the rocket there ---------- */
  let trip = null;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3();
  const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();
  const _Y = new THREE.Vector3(0, 1, 0);
  const _qq = new THREE.Quaternion();

  const orbitBox = $("orbit-actions"), orbitInfo = $("orbit-info");
  const destBtns = document.querySelectorAll("[data-dest]");
  const tripStatus = $("trip-status");

  /* ---------- Rocket science: the rules of the game ---------- */
  /* PHYSICS-START */
  const G0 = 9.80665;   // m/s², standard gravity
  const MU_E = 398600;  // km³/s², Earth's gravitational parameter
  const R_E = 6371;     // km
  const V_ROT = 0.4651; // km/s, Earth's surface speed at the equator
  const G_LIMIT = 7;    // g, the most the spacecraft can survive
  const REF_LAT = 28.5, REF_TWR = 1.4, MARGIN = 1.06; // how the starting estimates are sized
  const STAGE_COST = 12; // $M per stage
  // isp: specific impulse (s). eps: tank + structure mass as a share of the propellant it carries.
  const ENGINES = {
    kerolox:  { label: "Kerolox",  isp: 310, eps: 0.055, structCost: 1.2, thrustCost: 1.5, fuelCost: 0.0005 },
    methalox: { label: "Methalox", isp: 340, eps: 0.065, structCost: 1.6, thrustCost: 2.4, fuelCost: 0.001 },
    hydrolox: { label: "Hydrolox", isp: 440, eps: 0.10,  structCost: 2.6, thrustCost: 6.0, fuelCost: 0.004 },
  };
  // Share of the propellant carried by each stage
  const STAGE_SPLIT = { 1: [1], 2: [0.72, 0.28], 3: [0.60, 0.28, 0.12], 4: [0.50, 0.27, 0.15, 0.08] };
  // Per orbit: alt = km of the first parking orbit, incl = inclination (null: leaves from a parking orbit),
  // above = extra delta-v (km/s) beyond that parking orbit, kg = payload, kw = solar power, craft = spacecraft cost ($M)
  const MISSION = {
    "ISS orbit":           { alt: 400, incl: 51.6, above: 0,    kg: 6000, kw: 12,  craft: 150, engine: "methalox", stages: 2 },
    "Polar orbit":         { alt: 600, incl: 90,   above: 0,    kg: 2500, kw: 4,   craft: 120, engine: "methalox", stages: 2 },
    "GPS orbit":           { alt: 400, incl: 55,   above: 3.41, kg: 2000, kw: 4.5, craft: 250, engine: "methalox", stages: 3 },
    "Geostationary orbit": { alt: 400, incl: null, above: 0, geo: true, kg: 5000, kw: 15, craft: 300, engine: "hydrolox", stages: 3 },
    "Lunar polar orbit":   { alt: 400, incl: null, above: 4.03, kg: 4000, kw: 3.5, craft: 450, engine: "hydrolox", stages: 3 },
    "Lunar relay orbit":   { alt: 400, incl: null, above: 3.83, kg: 2500, kw: 2.5, craft: 300, engine: "hydrolox", stages: 3 },
    "Mars polar orbit":    { alt: 400, incl: null, above: 5.7,  kg: 2200, kw: 6,   craft: 700, engine: "hydrolox", stages: 3 },
    "Mars relay orbit":    { alt: 400, incl: null, above: 4.7,  kg: 2000, kw: 5,   craft: 550, engine: "hydrolox", stages: 3 },
    "Phobos orbit":        { alt: 400, incl: null, above: 4.9,  kg: 1800, kw: 4,   craft: 520, engine: "hydrolox", stages: 3 },
    "Deimos orbit":        { alt: 400, incl: null, above: 4.6,  kg: 1800, kw: 4,   craft: 500, engine: "hydrolox", stages: 3 },
  };

  function designCost(d, m) {
    const e = ENGINES[d.engine];
    return (m.craft + 1.2 * d.kw + e.eps * d.fuel * e.structCost + d.thrust * e.thrustCost + d.fuel * e.fuelCost + d.stages * STAGE_COST) * 1.08;
  }

  // d = { fuel (t), mass (t, at liftoff), thrust (MN), kw, budget ($M), engine, stages }
  function physics(d, m, latDeg) {
    const e = ENGINES[d.engine], split = STAGE_SPLIT[d.stages];
    const F = d.fuel, M0 = d.mass;
    const p = { payload: M0 - F * (1 + e.eps), eps: e.eps };

    // Tsiolkovsky rocket equation, one stage at a time: dv = Isp · g0 · ln(m0 / m1).
    // When a stage burns out, its empty tanks are dropped.
    let mb = M0, dv = 0, first = { fuel: F * split[0], m1: 1e-6 };
    p.stageDv = [];
    for (let i = 0; i < split.length; i++) {
      const Fi = F * split[i], m1 = mb - Fi;
      if (m1 <= 0) { dv = 0; break; }
      const dvi = e.isp * G0 * Math.log(mb / m1) / 1000;
      dv += dvi;
      p.stageDv.push(dvi);
      if (i === 0) first = { fuel: Fi, m1 };
      mb = m1 - e.eps * Fi;
    }
    p.dvAvail = dv;

    // Can it lift off, and how hard does it push on the way up?
    p.weight = M0 * 1000 * G0 / 1e6; // MN
    p.twr = d.thrust / p.weight;
    p.burn = d.thrust > 0 ? first.fuel * 1000 * e.isp * G0 / (d.thrust * 1e6) : Infinity; // s, first stage
    p.gmax = d.thrust * 1e6 / (first.m1 * 1000 * G0); // acceleration just before stage 1 burns out

    // Delta-v the orbit asks for, from this launch latitude
    const lat = Math.abs(latDeg), r = Math.PI / 180;
    const base = Math.sqrt(MU_E / (R_E + m.alt)); // circular orbit speed
    let rot, plane = 0;
    if (m.incl != null) {
      if (lat <= m.incl) rot = V_ROT * Math.cos(m.incl * r); // launch along the orbit's own heading
      else { rot = V_ROT * Math.cos(lat * r); plane = 2 * base * Math.sin((lat - m.incl) * r / 2); } // cannot reach a flatter orbit without a plane change
    } else rot = V_ROT * Math.cos(lat * r);
    const above = m.geo ? 2.43 + Math.sqrt(1.598 * 1.598 + 3.075 * 3.075 - 2 * 1.598 * 3.075 * Math.cos(lat * r)) : m.above;
    const gravity = Math.min(8, 0.6 * G0 * p.burn / 1000); // time spent fighting gravity on the way up
    p.parts = { base, rot, plane, above, gravity, drag: 0.15, steer: 0.10 };
    p.need = base - rot + plane + above + gravity + 0.25;
    p.cost = designCost(d, m);
    p.minKw = m.kw * 0.6;
    p.lat = lat;
    return p;
  }

  function judge(d, m, latDeg) {
    const p = physics(d, m, latDeg);
    p.mode = p.twr <= 1 ? "pad" : p.gmax > G_LIMIT ? "gload" : p.dvAvail < p.need ? "dv" : d.kw < p.minKw ? "power" : "ok";
    // A rocket that was never set up properly is not blocked any more: it is launched, and it fails
    const block = preflight(d, m);
    if (block) { p.mode = "setup"; p.block = block; }
    return p;
  }

  // Problems that stop the launch before it starts
  function preflight(d, m) {
    if (!(d.mass > 0) || !(d.fuel > 0) || !(d.thrust > 0)) return "Set up the rocket first. Everything starts at 0, so enter the fuel, mass, thrust, power and budget.";
    const p = physics(d, m, 0);
    if (!(d.mass > 0) || p.payload <= 0) return "The fuel and its tanks weigh more than the whole rocket. Raise the mass or lower the fuel.";
    const need = m.kg / 1000 * 0.95;
    if (p.payload < need) return "The payload is too light. This mission needs a spacecraft of about " + (m.kg / 1000).toFixed(1) + " t, and yours is " + Math.max(0, p.payload).toFixed(1) + " t. Raise the mass or lower the fuel.";
    if (p.cost > d.budget) return "Over budget: this design costs about $" + Math.round(p.cost) + " M and the budget is $" + Math.round(d.budget) + " M.";
    return null;
  }

  // A design that just reaches the orbit from a mid-latitude site, with a little spare delta-v
  function estimateFor(m, lat) {
    if (lat == null) lat = REF_LAT;
    const e = ENGINES[m.engine], P = m.kg / 1000;
    const mk = (F) => {
      const mass = P + F * (1 + e.eps);
      return { fuel: F, mass, thrust: REF_TWR * mass * G0 / 1000, kw: m.kw, budget: 0, engine: m.engine, stages: m.stages };
    };
    const short = (F) => { const p = physics(mk(F), m, lat); return p.dvAvail - MARGIN * p.need; };
    let lo = 0, hi = 1e5;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (short(mid) < 0) lo = mid; else hi = mid; }
    const F = Math.round(hi * 10) / 10;
    const mass = Math.ceil((P + F * (1 + e.eps)) * 10) / 10;
    const d = { fuel: F, mass, thrust: Math.ceil(REF_TWR * mass * G0 / 1000 * 10) / 10, kw: m.kw, budget: 0, engine: m.engine, stages: m.stages };
    d.budget = Math.ceil(designCost(d, m) * 1.1 / 5) * 5;
    return d;
  }
  /* PHYSICS-END */

  const ESTIMATES = {};
  const MKEYS = ["fuel", "mass", "thrust", "kw", "budget"]; // the figures a person can type in
  const MISSION_MAX = { fuel: 1, mass: 1, thrust: 1, kw: 1, budget: 1, payload: 1 };
  Object.keys(MISSION).forEach((t) => {
    const d = ESTIMATES[t] = estimateFor(MISSION[t]);
    MKEYS.forEach((k) => { MISSION_MAX[k] = Math.max(MISSION_MAX[k], d[k]); });
    MISSION_MAX.payload = Math.max(MISSION_MAX.payload, MISSION[t].kg / 1000);
  });

  // The rocket the person is building. It is ONE configuration, kept only in memory, so it starts at 0 on every
  // page load and is never touched by choosing a city, an orbit or a destination. Only the person changes it.
  let EDITS = {};
  const saveEdits = () => {}; // nothing is stored between visits any more
  const BLANK_DESIGN = { fuel: 0, mass: 0, thrust: 0, kw: 0, budget: 0, engine: "kerolox", stages: 1 };
  const designFor = () => Object.assign({}, BLANK_DESIGN, EDITS);

  const mInput = {};
  MKEYS.concat("payload").forEach((k) => { mInput[k] = $("m-" + k); });
  const mReset = $("mission-reset");
  const engBtns = document.querySelectorAll("[data-engine]"), stgBtns = document.querySelectorAll("[data-stages]");
  const costEl = $("design-cost"), launchMsg = $("launch-msg");
  let missionTitle = null;

  const fmtNum = (v) => String(+(+v).toFixed(2));
  function paintStat(k) {
    const inp = mInput[k];
    inp.style.width = Math.max(2, inp.value.length + 1) + "ch";
    const v = parseFloat(inp.value);
    const frac = isFinite(v) ? Math.min(1, Math.max(0, v) / MISSION_MAX[k]) : 0;
    $("m-" + k + "-bar").style.width = Math.max(4, Math.round(frac * 100)) + "%";
    inp.closest(".stat").classList.toggle("is-edited", MKEYS.indexOf(k) >= 0 && k in EDITS);
  }
  // Payload and cost follow from whatever is typed in
  function paintDerived() {
    if (!missionTitle) return;
    updateLaunchState();
    paintSite();
    const m = MISSION[missionTitle], d = designFor(missionTitle);
    const p = physics(d, m, REF_LAT);
    mInput.payload.value = fmtNum(Math.max(0, p.payload));
    paintStat("payload");
    paintForecast(d, m);
    const blank = !(d.fuel > 0 || d.mass > 0 || d.thrust > 0 || d.kw > 0 || d.budget > 0);
    mInput.payload.closest(".stat").classList.toggle("is-bad", !blank && !(p.payload >= m.kg / 1000 * 0.95));
    if (blank) { costEl.classList.remove("over"); costEl.textContent = ""; return; }
    const over = p.cost > d.budget;
    costEl.classList.toggle("over", over);
    costEl.textContent = "This design costs about $" + Math.round(p.cost).toLocaleString("en-US") + " M" + (over ? ", over your budget." : " of your $" + Math.round(d.budget).toLocaleString("en-US") + " M budget.");
  }
  function showLaunchMsg(text) { launchMsg.textContent = text; launchMsg.hidden = false; }
  function hideLaunchMsg() { launchMsg.hidden = true; launchMsg.classList.remove("hint"); }

  // Why the rocket cannot launch right now (null = ready). Uses the same checks as the forecast and the real launch.
  const launchBtn = $("btn-launch");
  function launchProblem() {
    if (!state.city) return "Choose a launch location first.";
    const o = selectedOrbit();
    if (!o || !MISSION[o.title]) return "Choose an orbit to fly to.";
    return null; // the rocket figures never block a launch: a bad design simply fails
  }
  function updateLaunchState() {
    const why = launchProblem();
    launchBtn.disabled = !!why;
    if (why) { launchMsg.textContent = why; launchMsg.classList.add("hint"); launchMsg.hidden = false; }
    else hideLaunchMsg();
  }

  function renderMission(o) {
    const known = o && MISSION[o.title];
    $("mission-stats").classList.toggle("is-empty", !known);
    MKEYS.forEach((k) => { mInput[k].disabled = !known; });
    engBtns.forEach((b) => { b.disabled = !known; });
    stgBtns.forEach((b) => { b.disabled = !known; });
    hideLaunchMsg();
    if (!known) { missionTitle = null; mReset.hidden = true; costEl.textContent = ""; $("forecast").hidden = true; paintSite(); updateLaunchState(); return; }
    missionTitle = o.title;
    const d = designFor(missionTitle), edits = EDITS;
    MKEYS.forEach((k) => { mInput[k].value = fmtNum(d[k]); paintStat(k); });
    engBtns.forEach((b) => {
      const on = b.dataset.engine === d.engine;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    stgBtns.forEach((b) => {
      const on = +b.dataset.stages === d.stages;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    paintDerived();
    mReset.hidden = !Object.keys(edits).length;
  }
  function setEdit(k, v) {
    EDITS[k] = v;
    saveEdits();
    mReset.hidden = false;
  }
  MKEYS.forEach((k) => {
    const inp = mInput[k];
    inp.addEventListener("input", () => {
      if (!missionTitle) return;
      const v = parseFloat(inp.value);
      if (!isFinite(v) || v < 0) return; // wait until it is a valid number
      setEdit(k, v);
      hideLaunchMsg();
      paintStat(k);
      paintDerived();
    });
    inp.addEventListener("change", () => renderMission(selectedOrbit())); // tidy up whatever was typed
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    inp.closest(".stat").addEventListener("click", (e) => { if (e.target !== inp && !inp.disabled) inp.focus(); });
  });
  engBtns.forEach((b) => b.addEventListener("click", () => {
    if (!missionTitle) return;
    setEdit("engine", b.dataset.engine);
    renderMission(selectedOrbit());
  }));
  stgBtns.forEach((b) => b.addEventListener("click", () => {
    if (!missionTitle) return;
    setEdit("stages", +b.dataset.stages);
    renderMission(selectedOrbit());
  }));
  mReset.addEventListener("click", () => {
    if (!missionTitle) return;
    EDITS = {};
    renderMission(selectedOrbit());
  });


  /* ---------- Pre-launch forecast: the same physics as the real launch, shown before you press the button ---------- */
  const fcEl = $("forecast");
  function paintForecast(d, m) {
    if (!state.city) { fcEl.hidden = true; return; }
    const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
    const blank = !(d.fuel > 0 || d.mass > 0 || d.thrust > 0 || d.kw > 0 || d.budget > 0);
    const svg = $("fc-svg"), list = $("fc-checks");
    fcEl.hidden = false;
    if (blank) {
      fcEl.className = "report forecast idle";
      $("fc-title").textContent = "Predicted trajectory";
      $("fc-text").textContent = "Enter your rocket figures above and the predicted flight path appears here, before you launch.";
      svg.hidden = true; list.textContent = "";
      return;
    }
    const p = judge(d, m, state.city.lat);
    if (p.mode === "setup") {
      fcEl.className = "report forecast fail";
      $("fc-title").textContent = "Predicted: launch fails";
      $("fc-text").textContent = p.block;
      svg.hidden = true; list.textContent = "";
      return;
    }
    const kind = p.mode === "ok" ? "ok" : p.mode === "power" ? "warn" : "fail";
    const titles = {
      ok: "Predicted: orbit reached",
      power: "Predicted: in orbit, spacecraft dead",
      pad: "Predicted: lost on the pad",
      gload: "Predicted: rocket breaks apart",
      dv: "Predicted: falls short of orbit",
    };
    const texts = {
      ok: "Delta-v " + f2(p.dvAvail) + " km/s against " + f2(p.need) + " km/s needed, " + Math.round((p.dvAvail / p.need - 1) * 100) + "% to spare.",
      power: "The rocket reaches orbit, but " + fmtNum(d.kw) + " kW is below the " + f1(p.minKw) + " kW the spacecraft needs.",
      pad: "Thrust-to-weight is " + f2(p.twr) + ". It needs to be above 1 to leave the ground.",
      gload: "Acceleration peaks at " + f1(p.gmax) + " g before first-stage burnout, above the " + G_LIMIT + " g limit.",
      dv: "Only " + f2(p.dvAvail) + " km/s of the " + f2(p.need) + " km/s needed, " + Math.round((1 - p.dvAvail / p.need) * 100) + "% short.",
    };
    fcEl.className = "report forecast " + kind;
    $("fc-title").textContent = titles[p.mode];
    $("fc-text").textContent = texts[p.mode];

    // Ascent path. It is a schematic curve, but how far along it the rocket gets comes from the numbers:
    // delta-v available / delta-v needed (stage separations sit at each stage's share of the delta-v).
    const X0 = 16, X1 = 284, YG = 112, YO = 24;
    const pt = (s) => [X0 + (X1 - X0) * s, YG - (YG - YO) * (1 - (1 - s) * (1 - s))];
    let f = 1;
    if (p.mode === "pad") f = 0.02;
    else if (p.mode === "gload") f = THREE.MathUtils.clamp(p.stageDv[0] / p.need, 0.06, 0.95);
    else if (p.mode === "dv") f = THREE.MathUtils.clamp(p.dvAvail / p.need, 0.04, 0.97);
    const trace = (a, b) => {
      let s = "";
      const n = 40;
      for (let i = 0; i <= n; i++) { const q = pt(a + (b - a) * i / n); s += (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }
      return s;
    };
    const col = { ok: "#8be3b0", warn: "#ffd27f", fail: "#ff7a66" }[kind];
    let g = '<line class="fc-ground" x1="8" y1="' + YG + '" x2="292" y2="' + YG + '"/>' +
      '<line class="fc-orbit" x1="8" y1="' + YO + '" x2="292" y2="' + YO + '"/>' +
      '<text class="fc-lbl" x="10" y="' + (YO - 6) + '">' + m.alt + ' km orbit</text>' +
      '<text class="fc-lbl" x="10" y="' + (YG + 12) + '">' + state.city.name + '</text>' +
      '<path class="fc-plan" d="' + trace(0, 1) + '"/>' +
      '<path class="fc-flown" style="stroke:' + col + '" d="' + trace(0, f) + '"/>';
    let acc = 0;
    p.stageDv.forEach((dv, i) => {
      acc += dv;
      const s = acc / p.need;
      if (i < p.stageDv.length - 1 && s < f) { const q = pt(s); g += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="2.6" class="fc-sep"/>'; }
    });
    const e = pt(f);
    if (kind === "fail") {
      g += '<path class="fc-x" d="M' + (e[0] - 5) + " " + (e[1] - 5) + "l10 10m0 -10l-10 10" + '"/>';
    } else {
      g += '<circle cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="4" style="fill:' + col + '"/>';
    }
    svg.innerHTML = g;
    svg.hidden = false;

    const rows = [
      [p.twr > 1, "Lift-off", "thrust ÷ weight " + f2(p.twr) + " (needs above 1)"],
      [p.gmax <= G_LIMIT, "Peak acceleration", f1(p.gmax) + " g (limit " + G_LIMIT + " g)"],
      [p.dvAvail >= p.need, "Delta-v", f2(p.dvAvail) + " of " + f2(p.need) + " km/s"],
      [d.kw >= p.minKw, "Spacecraft power", fmtNum(d.kw) + " kW (needs " + f1(p.minKw) + " kW)"],
    ];
    list.textContent = "";
    rows.forEach((r) => {
      const li = document.createElement("li");
      li.className = r[0] ? "pass" : "miss";
      const a = document.createElement("span"), b = document.createElement("span");
      a.textContent = (r[0] ? "✓ " : "✗ ") + r[1];
      b.textContent = r[2];
      li.append(a, b);
      list.appendChild(li);
    });
  }


  /* ---------- Launch guide: every "right figure" in one place ---------- */
  const siteEl = $("site-card"), siteGrid = $("site-grid"), siteNote = $("site-note"), siteApply = $("site-apply");
  const siteIntro = $("site-intro"), guideBody = $("guide-body"), guideLimits = $("guide-limits");
  let siteRec = null; // what the button applies: { d: design, engine, stages }
  const nf = (v, dp) => (+v).toLocaleString("en-US", { maximumFractionDigits: dp == null ? 1 : dp });
  function paintSite() {
    siteRec = null;
    if (!missionTitle) { siteEl.hidden = true; return; }
    siteEl.hidden = false;
    const lat = state.city ? state.city.lat : REF_LAT;
    const where = state.city ? state.city.name : "a mid-latitude site (" + REF_LAT + "°)";
    const cur = designFor(missionTitle);
    const m = Object.assign({}, MISSION[missionTitle], { engine: cur.engine, stages: cur.stages });
    const here = estimateFor(m, lat), eq = estimateFor(m, 0);
    const ph = judge(here, m, lat);
    const ename = ENGINES[m.engine].label, stg = m.stages + (m.stages === 1 ? " stage" : " stages");
    const blank = !(cur.fuel > 0 || cur.mass > 0 || cur.thrust > 0 || cur.kw > 0 || cur.budget > 0);

    // Cheapest engine and stage count that reaches this orbit from here
    let best = null;
    Object.keys(ENGINES).forEach((en) => [1, 2, 3, 4].forEach((n) => {
      const mm = Object.assign({}, m, { engine: en, stages: n }), dd = estimateFor(mm, lat);
      if (judge(dd, mm, lat).mode === "ok") { const c = designCost(dd, mm); if (!best || c < best.c) best = { c, en, n, d: dd }; }
    }));

    siteIntro.textContent = (blank ? "Every figure starts at 0. " : "") + "Worked out for " + where + " and the " + m.alt + " km start of this orbit, with about 6% delta-v to spare. Type your own figures below, or apply these.";
    guideBody.textContent = ""; siteGrid.textContent = ""; guideLimits.textContent = "";
    siteApply.hidden = true;

    const limits = physics(here, m, lat), curP = physics(cur, m, lat);

    if (ph.mode !== "ok") {
      // Nothing with this engine and stage count gets there: say what does
      siteNote.textContent = "From " + where + ", no " + ename + " rocket with " + stg + " can reach this orbit." +
        (best ? " Try " + ENGINES[best.en].label + " with " + best.n + (best.n === 1 ? " stage." : " stages.") : " Try more stages or a stronger engine.");
      if (best) {
        siteRec = { d: best.d, engine: best.en, stages: best.n };
        siteApply.textContent = "Switch to " + ENGINES[best.en].label + ", " + best.n + (best.n === 1 ? " stage" : " stages");
        siteApply.hidden = false;
      }
    } else {
      siteRec = { d: here, engine: m.engine, stages: m.stages };
      siteApply.textContent = "Use these figures";
      siteApply.hidden = false;

      const mk = (label, rec, yours, dp, unit, pre) => {
        const tr = document.createElement("tr"), th = document.createElement("th"), r = document.createElement("td"), y = document.createElement("td");
        const f = (v) => (pre || "") + nf(v, dp) + (unit ? " " + unit : "");
        th.scope = "row"; th.textContent = label; r.textContent = f(rec);
        if (yours > 0) {
          const off = yours / rec - 1, close = Math.abs(off) <= 0.1;
          y.textContent = f(yours);
          y.className = close ? "gd-ok" : "gd-off";
          y.title = close ? "Close to the right figure" : (off < 0 ? "Below" : "Above") + " the right figure by " + nf(Math.abs(off) * 100, 0) + "%";
        } else { y.textContent = "–"; y.className = "gd-none"; }
        tr.append(th, r, y); guideBody.appendChild(tr);
      };
      const fuelPct = eq.fuel > 0 ? (here.fuel / eq.fuel - 1) * 100 : 0;
      mk("Fuel" + (fuelPct >= 0.5 ? " (+" + nf(fuelPct, 0) + "% vs equator)" : ""), here.fuel, cur.fuel, 1, "t");
      mk("Mass", here.mass, cur.mass, 1, "t");
      mk("Thrust", here.thrust, cur.thrust, 1, "MN");
      mk("Power", here.kw, cur.kw, 1, "kW");
      mk("Budget", here.budget, cur.budget, 0, "M", "$");
      mk("Payload", m.kg / 1000, curP.payload, 1, "t");

      const needEq = physics(here, m, 0).need, extra = ph.need - needEq;
      [
        ["Earth's spin here", nf(V_ROT * 1000 * Math.cos(Math.abs(lat) * Math.PI / 180), 0) + " m/s"],
        ["Lowest orbit tilt", nf(Math.abs(lat)) + "°"],
        ["Delta-v needed", nf(ph.need, 2) + " km/s"],
        ["Extra vs equator", (extra < 0.005 ? "+0.00" : "+" + nf(extra, 2)) + " km/s"],
      ].forEach((r) => {
        const box = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = r[0]; dd.textContent = r[1]; box.append(dt, dd); siteGrid.appendChild(box);
      });

      let note = "Fuel, mass, thrust and budget are for " + ename + " with " + stg + ". Payload is what is left after the fuel and tanks (mass − fuel − tanks).";
      if (ph.parts.plane > 0.005) note += " This orbit is flatter than " + where + "'s latitude, so a plane change adds " + nf(ph.parts.plane, 2) + " km/s.";
      if (best && (best.en !== m.engine || best.n !== m.stages) && best.c < designCost(here, m) * 0.95)
        note += " Cheapest setup that works: " + ENGINES[best.en].label + " with " + best.n + (best.n === 1 ? " stage" : " stages") + " (about $" + nf(best.c, 0) + " M).";
      siteNote.textContent = note;
    }

    // The limits every launch is judged against, with this orbit's numbers
    [
      ["Thrust ÷ weight", "above 1 (guide uses " + REF_TWR + ")"],
      ["Peak acceleration", "at most " + G_LIMIT + " g"],
      ["Delta-v", "at least " + nf(limits.need, 2) + " km/s"],
      ["Power", "at least " + nf(m.kw * 0.6, 1) + " kW"],
      ["Payload", "at least " + nf(m.kg / 1000 * 0.95, 1) + " t"],
      ["Cost", "within budget"],
    ].forEach((r) => {
      const li = document.createElement("li"), a = document.createElement("span"), b = document.createElement("span");
      a.textContent = r[0]; b.textContent = r[1]; li.append(a, b); guideLimits.appendChild(li);
    });
  }
  siteApply.addEventListener("click", () => {
    if (!siteRec || !missionTitle) return;
    MKEYS.forEach((k) => setEdit(k, siteRec.d[k]));
    setEdit("engine", siteRec.engine);
    setEdit("stages", siteRec.stages);
    renderMission(selectedOrbit());
  });

  /* ---------- Flight report ---------- */
  const reportEl = $("flight-report");
  const signed = (v) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(2);
  const clearBtn = $("btn-clear");
  function hideReport() { reportEl.hidden = true; clearBtn.hidden = true; }
  function showReport(T) {
    const p = T.verdict, d = T.design, m = T.mission;
    const kind = p.mode === "ok" ? "ok" : p.mode === "power" ? "warn" : "fail";
    const f1 = (x) => (isFinite(x) ? x.toFixed(1) : "—"), f2 = (x) => (isFinite(x) ? x.toFixed(2) : "—");
    let title, text;
    if (p.mode === "setup") {
      title = "Rocket lost on the pad";
      text = p.block;
    } else if (p.mode === "ok") {
      title = "Orbit reached";
      text = "The rocket had " + f2(p.dvAvail) + " km/s of delta-v and the " + T.orbit.title + " needed " + f2(p.need) + " km/s, so it got there with " + Math.round((p.dvAvail / p.need - 1) * 100) + "% to spare.";
    } else if (p.mode === "power") {
      title = "In orbit, but the spacecraft is dead";
      text = "The rocket did its job, but the spacecraft has only " + fmtNum(d.kw) + " kW of power and needs at least " + f1(p.minKw) + " kW to run its systems.";
    } else if (p.mode === "pad") {
      title = "Rocket lost on the pad";
      text = "Thrust is " + f1(d.thrust) + " MN but the rocket weighs " + f1(p.weight) + " MN (thrust-to-weight " + f2(p.twr) + "). To lift off, thrust has to be bigger than weight.";
    } else if (p.mode === "gload") {
      title = "Rocket broke apart";
      text = "As the first stage emptied, acceleration climbed to " + f1(p.gmax) + " g. The spacecraft can only take about " + G_LIMIT + " g. Use less thrust or carry more fuel.";
    } else {
      title = "Rocket fell short of orbit";
      text = "It had " + f2(p.dvAvail) + " km/s of delta-v but needed " + f2(p.need) + " km/s, which is " + Math.round((1 - p.dvAvail / p.need) * 100) + "% short. Add fuel, add a stage, pick a more efficient engine, or carry less payload.";
    }
    reportEl.className = "report " + kind;
    $("report-title").textContent = title;
    $("report-text").textContent = text;

    const grid = $("report-grid");
    grid.textContent = "";
    [["Delta-v available", f2(p.dvAvail) + " km/s"], ["Delta-v needed", f2(p.need) + " km/s"],
     ["Thrust-to-weight", f2(p.twr)], ["Peak acceleration", f1(p.gmax) + " g"]].forEach((r) => {
      const box = document.createElement("div");
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = r[0]; dd.textContent = r[1];
      box.append(dt, dd);
      grid.appendChild(box);
    });

    const det = $("report-detail");
    det.textContent = "";
    const line = (a, b, cls) => {
      const row = document.createElement("div");
      row.className = "row" + (cls ? " " + cls : "");
      const x = document.createElement("span"), y = document.createElement("span");
      x.textContent = a; y.textContent = b;
      row.append(x, y);
      det.appendChild(row);
    };
    const pt = p.parts;
    const intro = document.createElement("p");
    intro.textContent = "Launched from " + state.city.name + " (" + f1(p.lat) + "° latitude). Each stage gives Δv = Isp · g₀ · ln(m₀ / m_f). The orbit asks for:";
    det.appendChild(intro);
    line("Orbital speed", signed(pt.base));
    line("Earth's rotation helps", signed(-pt.rot));
    if (pt.plane > 0.005) line("Plane change (site is above the orbit's tilt)", signed(pt.plane));
    if (pt.above > 0.005) line("Transfer to the destination", signed(pt.above));
    line("Gravity loss while climbing", signed(pt.gravity));
    line("Drag and steering", signed(pt.drag + pt.steer));
    line("Total needed", f2(p.need) + " km/s", "total");

    reportEl.hidden = false;
    clearBtn.hidden = false; // launch is over (success or failure): offer a way to start again from 0
    reportEl.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }

  // How far a failing rocket gets before it is lost
  function failPlan(p, dur) {
    if (p.mode === "pad" || p.mode === "setup") return { mode: "pad", t: Math.max(1.1, dur * 0.35) }; // lifts off a little, then blows up
    if (p.mode === "gload") return { mode: "gload", t: dur * 0.3 };
    if (p.mode === "dv") return { mode: "dv", t: dur * (0.35 + 0.5 * THREE.MathUtils.clamp((p.dvAvail / p.need - 0.4) / 0.6, 0, 1)) };
    return null;
  }

  function selectedOrbit() {
    return ORBIT_OPTIONS[state.dest][state.orbitSel[state.dest]] || null;
  }

  function renderOrbitChoices() {
    const list = ORBIT_OPTIONS[state.dest];
    const cur = state.orbitSel[state.dest];
    destBtns.forEach((b) => {
      const on = b.dataset.dest === state.dest;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    orbitBox.textContent = "";
    list.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pill" + (i === cur ? " is-on" : "");
      b.setAttribute("aria-pressed", String(i === cur));
      b.textContent = o.chip;
      b.addEventListener("click", () => {
        state.orbitSel[state.dest] = i;
        renderOrbitChoices();
        orbitBox.children[i].focus();
      });
      orbitBox.appendChild(b);
    });
    orbitInfo.textContent = list[cur] ? list[cur].desc : "";
    renderMission(list[cur]);
    hideReport();
  }
  destBtns.forEach((b) =>
    b.addEventListener("click", () => {
      state.dest = b.dataset.dest;
      renderOrbitChoices();
    })
  );

  // The city panel normally hides in the Moon / Mars views, but stays while a rocket is flying there
  function syncPanel() {
    const away = state.view === "moon" || state.view === "mars";
    cityPanel.classList.toggle("is-hidden", away && !trip);
  }

  /* ---- geometry helpers ---- */
  // Where the pad's rocket sits in world space (rotation only, so Earth's shrink animation can't distort it)
  function padWorld(out) {
    return out.copy(state.city.vec).transformDirection(earthGroup.matrixWorld).multiplyScalar(1 + PAD_H);
  }
  // A point on the chosen orbit ring, in world space (the ring may be tilted, moving, or rotated by the user)
  function orbitPoint(out, th) {
    const o = trip.orbit;
    o.pivot.updateWorldMatrix(true, false);
    return out.set(Math.cos(th) * o.radius, 0, Math.sin(th) * o.radius).applyMatrix4(o.pivot.matrixWorld);
  }
  // Angle on the ring that lies closest to a world-space point
  function localAngle(pivot, worldPt) {
    pivot.updateWorldMatrix(true, false);
    const l = pivot.worldToLocal(_t1.copy(worldPt));
    return Math.atan2(l.z, l.x);
  }
  // Spherical interpolation between two unit vectors
  function slerpDir(out, a, b, t) {
    const om = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    if (om < 1e-4) return out.copy(b);
    const s = Math.sin(om);
    return out.copy(a).multiplyScalar(Math.sin((1 - t) * om) / s).addScaledVector(b, Math.sin(t * om) / s);
  }

  /* ---- trip control ---- */
  function endTrip(toPad) {
    const had = !!trip;
    trip = null;
    tripStatus.textContent = "";
    if (rocketTrail) rocketTrail.obj.visible = false;
    if (had && rocket) {
      if (toPad !== false && state.city) placeRocket(state.city);
      else rocket.visible = false;
    }
    syncPanel();
  }

  // Lift off: the rocket leaves the pad (it stops being a child of the spinning Earth)
  function beginAscent() {
    const T = trip;
    earthGroup.getWorldQuaternion(_qq);
    rocket.quaternion.premultiply(_qq);
    padWorld(_a);
    scene.add(rocket);
    rocket.position.copy(_a);
    rocket.scale.setScalar(PAD_SCALE);
    rocket.updateMatrixWorld(true);
    rocket.userData.pad.visible = false;
    rocket.userData.flame.visible = true;
    T.last.copy(_a);
    // Enter the ring at the point nearest to where we come from
    if (T.dest === "earth") T.th0 = localAngle(T.orbit.pivot, _a);
    else if (T.dest === "moon") T.th0 = localAngle(T.orbit.pivot, _zero);
    _t2.set(0, -ROCKET_H / 2, 0).applyMatrix4(rocket.matrixWorld);
    resetTrail(_t2);
    rocketTrail.obj.visible = true;
    T.phase = 0;
    T.t = 0;
  }

  function launch() {
    if (!state.city || !rocket) return;
    if (launchProblem()) { updateLaunchState(); return; } // only when there is no site or orbit chosen
    const dest = state.dest;
    const orbit = selectedOrbit();
    if (!orbit) return;
    const mission = MISSION[orbit.title], design = designFor(orbit.title);
    hideLaunchMsg();
    hideReport();
    const verdict = judge(design, mission, state.city.lat);
    endTrip(); // relaunching: put the rocket back on its pad first

    state.orbits = true; // the rings have to be visible
    const ob = $("btn-orbits");
    ob.classList.add("is-on");
    ob.setAttribute("aria-pressed", "true");
    if (dest === "moon") {
      if (state.view !== "all") setView("all");
    } else if (state.view !== "all" && state.view !== "earth") setView("earth");

    trip = {
      dest, orbit,
      phase: -1, // -1 = waiting for Earth to be back in view
      t: 0, th: 0, th0: 0,
      from: new THREE.Vector3(), last: new THREE.Vector3(), refPrev: null,
      dur: dest === "moon" ? 3.6 : dest === "mars" ? 2.2 : 2.6,
      speed: Math.max(orbit.speed, 0.3),
      S: DEST_SCALE[dest],
      verdict, design, mission, fail: null,
    };
    trip.fail = failPlan(verdict, trip.dur);
    tripStatus.textContent = "Heading to " + orbit.title + "…";
    if (state.earthPresence > 0.95) beginAscent();
    syncPanel();
  }

  function orbitReached(T) {
    tripStatus.textContent = T.verdict.mode === "power" ? "In orbit, but the spacecraft lost power" : "In " + T.orbit.title;
    showReport(T);
  }

  function updateTrip(dt) {
    if (!trip) return;
    if (!state.city) { endTrip(false); return; }
    const T = trip, o = rocket;
    if (T.phase < 0) {
      if (state.earthPresence > 0.95) beginAscent();
      return;
    }
    if (T.phase === 3) { // the rocket has exploded: let the blast play out, then bring a fresh rocket to the pad
      T.t += dt;
      if (T.t > 3.4) endTrip(true);
      return;
    }
    if (T.fail && T.phase === 0 && T.t + dt >= T.fail.t) { explodeRocket(); return; }
    T.t += dt;
    const k = Math.min(1, T.t / T.dur);
    const e = k * k * (3 - 2 * k);
    let sc = T.S;
    const hold = false; // every failing rocket now lifts off first, then explodes

    if (T.phase === 0) {
      padWorld(_a);
      if (hold) {
        o.position.copy(_a);
      } else if (T.dest === "earth") {
        // Straight up first, then curve onto the ring (never dips below the surface)
        orbitPoint(_b, T.th0);
        const r0 = _a.length(), r1 = _b.length();
        _t1.copy(_a).normalize();
        _t2.copy(_b).normalize();
        slerpDir(_t3, _t1, _t2, e);
        o.position.copy(_t3).multiplyScalar(r0 + (r1 - r0) * (1 - Math.pow(1 - k, 2.2)));
      } else if (T.dest === "moon") {
        orbitPoint(_b, T.th0);
        _s.copy(_a).normalize().multiplyScalar(3); // bend the path so it never cuts through Earth
        const u = 1 - e;
        o.position.set(0, 0, 0).addScaledVector(_a, u * u).addScaledVector(_s, 2 * u * e).addScaledVector(_b, e * e);
      } else {
        _b.copy(_a).normalize().multiplyScalar(3.5);
        o.position.lerpVectors(_a, _b, e);
      }
      sc = hold || T.dest === "mars" ? PAD_SCALE : PAD_SCALE + (T.S - PAD_SCALE) * e;
      if (k >= 1) {
        if (T.dest === "mars") {
          T.from.copy(o.position);
          setView("mars");
          T.th0 = localAngle(T.orbit.pivot, T.from);
          T.phase = 1; T.t = 0; T.dur = 2.8;
        } else {
          if (T.dest === "moon") setView("moon");
          T.th = T.th0;
          T.phase = 2;
          orbitReached(T);
        }
      }
    } else if (T.phase === 1) {
      orbitPoint(_b, T.th0);
      o.position.lerpVectors(T.from, _b, e);
      sc = PAD_SCALE + (T.S - PAD_SCALE) * e;
      if (k >= 1) {
        T.th = T.th0;
        T.phase = 2;
        orbitReached(T);
      }
    } else {
      T.th += dt * T.speed;
      orbitPoint(o.position, T.th);
    }
    o.scale.setScalar(sc);

    // The nose follows the direction of travel
    _t1.copy(o.position).sub(T.last);
    if (T.phase === 2) {
      // measure motion relative to the body being orbited, so a drifting Moon doesn't skew the heading
      _t2.setFromMatrixPosition(T.orbit.pivot.matrixWorld);
      if (T.refPrev) _t1.sub(_t3.copy(_t2).sub(T.refPrev));
      else T.refPrev = new THREE.Vector3();
      T.refPrev.copy(_t2);
    }
    if (_t1.lengthSq() > 1e-9) {
      _qq.setFromUnitVectors(_Y, _t1.normalize());
      o.quaternion.slerp(_qq, Math.min(1, dt * 9));
    }
    T.last.copy(o.position);

    // Exhaust flame and trail
    const fl = o.userData.flame;
    const power = T.phase < 2 ? 1 : 0.35;
    fl.visible = true;
    fl.scale.set(0.9 + Math.random() * 0.2, Math.max(0.05, power * (0.85 + 0.25 * Math.random())), 0.9 + Math.random() * 0.2);
    o.updateMatrixWorld(true);
    _t2.set(0, -ROCKET_H / 2, 0).applyMatrix4(o.matrixWorld);
    pushTrail(_t2);
  }

  // Idle pad glow, and a pulsing highlight on the ring of the orbit that is currently picked
  function updateRocketFx() {
    const t = performance.now() * 0.001;
    if (rocket && rocket.visible && !trip) {
      rocket.userData.pad.material.opacity = 0.45 + 0.3 * Math.sin(t * 3);
    }
    const sel = state.city ? selectedOrbit() : null;
    for (const key in ORBIT_OPTIONS) {
      for (const o of ORBIT_OPTIONS[key]) {
        const on = o === sel;
        o.ring.material.opacity = on ? 0.7 + 0.25 * Math.sin(t * 4) : o.baseOpacity;
        o.ring.material.color.setHex(on ? 0xffffff : o.color);
      }
    }
  }

  /* ---------- Explosion ---------- */
  const blasts = [];
  let blastTex = null;
  const FIRE_COLORS = [0xffe3a0, 0xffb347, 0xff7a22, 0xe8501a];

  function spawnBlast(at, size) {
    blastTex = blastTex || makeGlowTexture();
    const group = new THREE.Group();
    group.position.copy(at);
    const up = at.clone().normalize();
    const down = up.clone().negate();
    const rnd = (a, b) => a + Math.random() * (b - a);
    const sphere = (r) => {
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      while (v.lengthSq() > 1 || v.lengthSq() < 0.01) v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      return v.normalize().multiplyScalar(r);
    };
    const sprite = (color, blending, opacity) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: blastTex, color, blending, transparent: true, opacity, depthWrite: false, depthTest: false,
      }));
      s.renderOrder = 20;
      group.add(s);
      return s;
    };
    const b = { group, t: 0, dur: 3.2, size, up, down, fire: [], smoke: [], chunks: [] };

    b.flash = sprite(0xfff1c2, THREE.AdditiveBlending, 1);
    for (let i = 0; i < 16; i++) {
      b.fire.push({
        s: sprite(FIRE_COLORS[i % 4], THREE.AdditiveBlending, 1),
        d: rnd(0, 0.18), life: rnd(0.9, 1.7), r: rnd(0.9, 1.7), off: sphere(rnd(0.05, 0.3) * size),
      });
    }
    for (let i = 0; i < 10; i++) {
      b.smoke.push({
        s: sprite(0x2b2b33, THREE.NormalBlending, 0.5),
        d: rnd(0.15, 0.6), life: rnd(1.8, 2.8), r: rnd(0.8, 1.5), off: sphere(rnd(0.05, 0.35) * size),
      });
    }

    // Shock ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      })
    );
    ring.renderOrder = 20;
    group.add(ring);
    b.ring = ring;

    // Sparks
    const N = 150;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = sphere(rnd(0.2, 1.0) * size * 1.6);
      vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const sparks = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 4, sizeAttenuation: false, map: blastTex, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    sparks.frustumCulled = false;
    sparks.renderOrder = 20;
    group.add(sparks);
    b.sparks = { pos, col, vel, geo, life: 1.9 };

    // Pieces of rocket
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xf2f5fb, metalness: 0.25, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0xe5432f, metalness: 0.3, roughness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.8, roughness: 0.4 }),
    ];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(rnd(0.008, 0.022), rnd(0.012, 0.04), rnd(0.008, 0.022)),
        mats[i % 3]
      );
      m.position.copy(sphere(rnd(0.02, 0.08) * size));
      group.add(m);
      b.chunks.push({
        m, vel: sphere(rnd(0.25, 0.9) * size * 1.2),
        spin: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)),
      });
    }
    b.mats = mats;
    scene.add(group);
    blasts.push(b);
    if (!reduceMotion) state.shake = Math.max(state.shake || 0, 0.05);
  }

  function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      b.t += dt;
      const t = b.t, S = b.size, down = b.down, up = b.up;

      const f = Math.min(1, t / 0.45);
      b.flash.material.opacity = 1 - f;
      b.flash.scale.setScalar((0.25 + 1.1 * Math.sqrt(f)) * S * 2.2);

      for (const p of b.fire) {
        const a = (t - p.d) / p.life;
        p.s.visible = a >= 0 && a < 1;
        if (!p.s.visible) continue;
        p.s.scale.setScalar(p.r * S * (0.25 + 0.9 * Math.sqrt(a)) * 1.3);
        p.s.position.copy(p.off).multiplyScalar(1 + a * 1.2);
        p.s.material.opacity = Math.pow(1 - a, 1.4);
        p.s.material.color.setHSL(0.11 - 0.09 * a, 1, 0.62 - 0.3 * a);
      }
      for (const p of b.smoke) {
        const a = (t - p.d) / p.life;
        p.s.visible = a >= 0 && a < 1;
        if (!p.s.visible) continue;
        p.s.scale.setScalar(p.r * S * (0.3 + 0.9 * a) * 1.3);
        p.s.position.copy(p.off).addScaledVector(up, S * 0.5 * a);
        p.s.material.opacity = 0.5 * (1 - a) * Math.min(1, a * 6);
      }

      const ra = Math.min(1, t / 0.8);
      b.ring.visible = ra < 1;
      b.ring.scale.setScalar(Math.max(0.01, S * (0.2 + 2.6 * ra)));
      b.ring.material.opacity = 0.8 * Math.pow(1 - ra, 1.5);
      b.ring.quaternion.copy(camera.quaternion);

      const sp = b.sparks, g = 0.5 * (S / 0.4);
      const c = Math.max(0, 1 - t / sp.life);
      for (let j = 0; j < sp.pos.length; j += 3) {
        sp.vel[j] += down.x * g * dt; sp.vel[j + 1] += down.y * g * dt; sp.vel[j + 2] += down.z * g * dt;
        sp.pos[j] += sp.vel[j] * dt; sp.pos[j + 1] += sp.vel[j + 1] * dt; sp.pos[j + 2] += sp.vel[j + 2] * dt;
        sp.col[j] = c; sp.col[j + 1] = 0.65 * c * c; sp.col[j + 2] = 0.25 * c * c * c;
      }
      sp.geo.attributes.position.needsUpdate = true;
      sp.geo.attributes.color.needsUpdate = true;

      const sh = THREE.MathUtils.clamp((3.0 - t) / 0.8, 0, 1);
      for (const ch of b.chunks) {
        ch.vel.addScaledVector(down, g * 0.9 * dt);
        ch.m.position.addScaledVector(ch.vel, dt);
        ch.m.rotation.x += ch.spin.x * dt; ch.m.rotation.y += ch.spin.y * dt; ch.m.rotation.z += ch.spin.z * dt;
        ch.m.scale.setScalar(Math.max(0.001, sh));
        ch.m.visible = sh > 0;
      }

      if (t > b.dur) {
        scene.remove(b.group);
        b.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material && !b.mats.includes(o.material)) o.material.dispose();
        });
        b.mats.forEach((m) => m.dispose());
        blasts.splice(i, 1);
      }
    }
  }

  // The rocket is lost: it disappears in a fireball
  function explodeRocket() {
    const T = trip, o = rocket;
    o.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    o.visible = false;
    o.userData.flame.visible = false;
    rocketTrail.obj.visible = false;
    spawnBlast(p, 0.4);
    T.phase = 3;
    T.t = 0;
    tripStatus.textContent = "Rocket lost";
    showReport(T);
  }

  $("btn-launch").addEventListener("click", launch);
  // Clear: rocket back on its pad, report gone, every figure back to 0
  clearBtn.addEventListener("click", () => {
    EDITS = {};
    endTrip();
    hideReport();
    renderMission(selectedOrbit());
  });

  /* ---------- Interaction ---------- */
  const pointers = new Map();
  let lastX = 0, lastY = 0, pinchDist = 0;
  let tap = null;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    tap = pointers.size === 0 ? { x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse" } : null;
    state.fly = null;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    state.dragging = true;
    state.resetting = false;
    canvas.classList.add("dragging");
    lastX = e.clientX; lastY = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    hintEl.classList.add("hidden");
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    if (tap && (pointers.size > 1 || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6)) tap = null;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) setZoom(state.targetZoom * (pinchDist / dist));
      pinchDist = dist;
      return;
    }

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    const speed = 0.0055 * state.zoom;
    rotateBy(dx * speed, dy * speed);
    state.velY = dx * speed;
    state.velX = dy * speed;
  });

  function endPointer(e) {
    if (tap && e.type === "pointerup" && pointers.size === 1) pickAt(e.clientX, e.clientY, tap.touch ? 24 : 14);
    tap = null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      state.dragging = false;
      canvas.classList.remove("dragging");
    } else {
      const p = [...pointers.values()][0];
      lastX = p.x; lastY = p.y;
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  function setZoom(z) {
    state.targetZoom = THREE.MathUtils.clamp(z, 0.45, 1.8);
  }
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      setZoom(state.targetZoom * (1 + e.deltaY * 0.0012));
      hintEl.classList.add("hidden");
    },
    { passive: false }
  );

  function bindToggle(id, key, onChange) {
    const btn = document.getElementById(id);
    btn.addEventListener("click", () => {
      state[key] = !state[key];
      btn.classList.toggle("is-on", state[key]);
      btn.setAttribute("aria-pressed", String(state[key]));
      if (onChange) onChange(state[key]);
    });
  }
  bindToggle("btn-rotate", "autoRotate");
  bindToggle("btn-clouds", "clouds");
  bindToggle("btn-night", "night");
  bindToggle("btn-orbits", "orbits");
  bindToggle("btn-iss", "iss", (on) => { if (on) pollIss(); });

  /* View: both / Earth only / Moon only */
  const viewButtons = document.querySelectorAll(".views button");
  function setView(v) {
    state.view = v;
    state.targetZoom = 1;
    state.resetting = false;
    state.velX = state.velY = 0;
    getFocusTarget(v, _ft);
    state.focusOff.copy(state.focus).sub(_ft);
    if (v === "moon") { state.camYaw = 0; state.camPitch = 0.2; }
    viewButtons.forEach((b) => {
      const on = b.dataset.view === v;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    // Disable controls that don't apply to the current view
    document.getElementById("btn-clouds").disabled = v === "moon" || v === "mars";
    document.getElementById("btn-night").disabled = v === "moon" || v === "mars";
    document.getElementById("btn-rotate").disabled = v === "moon";
    document.getElementById("btn-orbits").disabled = v === "moon";
    document.getElementById("btn-iss").disabled = v === "moon" || v === "mars";
    syncPanel();
  }
  viewButtons.forEach((b) => b.addEventListener("click", () => { endTrip(); setView(b.dataset.view); }));
  document.getElementById("btn-reset").addEventListener("click", () => {
    clearCity();
    state.resetting = true;
    state.targetZoom = 1;
    state.velX = state.velY = 0;
  });

  window.addEventListener("resize", resize);

  /* ---------- Animation loop ---------- */
  const clock = new THREE.Clock();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Credits line: say honestly where the pictures came from ---------- */
  function setCredit(texs) {
    const el = document.getElementById("credit");
    if (!el) return;
    const src = (t) => (t && t.userData && t.userData.src) || "";
    const parts = [];
    const day = src(texs[0]), night = src(texs[1]);
    if (day.indexOf("gibs.earthdata.nasa.gov") >= 0 || night.indexOf("gibs.earthdata.nasa.gov") >= 0) {
      parts.push("Earth imagery: NASA GIBS (Blue Marble, Black Marble)");
    } else if (day.indexOf(LOCAL) === 0) {
      parts.push("Earth imagery: NASA, local files");
    } else {
      parts.push("Earth imagery: three.js example textures");
    }
    if (src(texs[4]).indexOf(LOCAL) === 0) parts.push("Moon and Mars: NASA / USGS, local files");
    parts.push("ISS position: wheretheiss.at");
    if (epic.credit) parts.push(epic.credit);
    el.textContent = parts.join(" \u00b7 ");
  }

  /* ---------- NASA EPIC (DSCOVR): the newest real photo of the whole Earth ----------
     Free, no API key, CORS-enabled:  https://epic.gsfc.nasa.gov/api/natural
     The page itself is unchanged; the result is shown in the credit line and kept in
     window.NASA_EPIC (image URL, time, centroid lat/lon, sun/moon positions) for later use. */
  // The direct NASA server first, then the api.nasa.gov mirror (the docs say the mirror adds CORS support).
  // DEMO_KEY works but is rate-limited; put your own free key from api.nasa.gov here if you get HTTP 429.
  const NASA_KEY = "DEMO_KEY";
  const EPIC_APIS = [
    "https://epic.gsfc.nasa.gov/api/natural",
    "https://api.nasa.gov/EPIC/api/natural?api_key=" + NASA_KEY,
    "https://api.nasa.gov/EPIC/api/natural/images?api_key=" + NASA_KEY,
  ];
  const epic = { credit: "", latest: null };
  async function fetchEpicList() {
    let lastErr = null;
    for (const url of EPIC_APIS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const list = await r.json();
        if (!Array.isArray(list) || !list.length) throw new Error("empty EPIC list");
        return list;
      } catch (e) {
        console.warn("EPIC source failed:", url, e);   // F12 Console shows which one and why
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error("EPIC unavailable");
  }
  async function loadEpic() {
    try {
      const list = await fetchEpicList();
      const m = list[list.length - 1];                    // newest frame of the day
      const day = m.date.slice(0, 10).split("-");          // "YYYY-MM-DD hh:mm:ss"
      epic.latest = {
        image: m.image,
        caption: m.caption,
        time: m.date + " UTC",
        centroid: m.centroid_coordinates,                  // {lat, lon} facing DSCOVR
        dscovr: m.dscovr_j2000_position,
        sun: m.sun_j2000_position,
        moon: m.lunar_j2000_position,
        url: "https://epic.gsfc.nasa.gov/archive/natural/" + day.join("/") + "/jpg/" + m.image + ".jpg",
      };
      window.NASA_EPIC = epic.latest;
      epic.credit = "NASA EPIC (DSCOVR) latest Earth image: " + m.date.slice(0, 16) + " UTC";
      console.info("NASA EPIC loaded:", epic.latest);
      const el = document.getElementById("credit");
      if (el && el.textContent.indexOf("NASA EPIC") < 0) el.textContent += " \u00b7 " + epic.credit;
    } catch (e) {
      console.error("NASA EPIC failed on every source:", e);
    }
  }

  /* ---------- Live ISS: real position, refreshed every few seconds ---------- */
  const ISS_API = "https://api.wheretheiss.at/v1/satellites/25544";
  const EARTH_KM = 6371;
  const ISS_TRAIL_MAX = 90;
  const iss = {
    pts: null, trail: null, trailGeo: null, trailPts: [],
    target: new THREE.Vector3(), cur: new THREE.Vector3(),
    ready: false, failed: 0, data: null, busy: false, timer: null,
  };
  const issReadout = document.getElementById("iss-readout");

  function llToVec(latDeg, lonDeg, r) {
    const p = THREE.MathUtils.degToRad(latDeg), l = THREE.MathUtils.degToRad(lonDeg);
    // same mapping as the city markers, so the ISS lines up with the map
    return new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l)).multiplyScalar(r);
  }

  function buildIss() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    iss.pts = new THREE.Points(geo, new THREE.PointsMaterial({
      map: dotTexture(), size: 11, sizeAttenuation: false, color: 0x7fe3ff,
      transparent: true, depthWrite: false,
    }));
    iss.pts.renderOrder = 12;
    iss.pts.frustumCulled = false;
    iss.pts.visible = false;
    earthGroup.add(iss.pts);

    iss.trailGeo = new THREE.BufferGeometry();
    iss.trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((ISS_TRAIL_MAX + 1) * 3), 3));
    iss.trailGeo.setDrawRange(0, 0);
    iss.trail = new THREE.Line(iss.trailGeo, new THREE.LineBasicMaterial({
      color: 0x7fe3ff, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    iss.trail.frustumCulled = false;
    iss.trail.visible = false;
    earthGroup.add(iss.trail);

    // The dot's position lives in the geometry, so the Points object itself sits at the globe's centre.
    // Give the label its own anchor that follows the ISS instead.
    iss.anchor = new THREE.Object3D();
    iss.anchor.visible = false;
    earthGroup.add(iss.anchor);
    addLabel("ISS live", iss.anchor, 0, "issMix");
    pollIss();
    iss.timer = setInterval(() => { if (state.iss && !document.hidden) pollIss(); }, 5000);
  }

  async function pollIss() {
    if (iss.busy) return;
    iss.busy = true;
    try {
      const r = await fetch(ISS_API, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      if (typeof d.latitude !== "number" || typeof d.longitude !== "number") throw new Error("bad data");
      const R = 1 + (typeof d.altitude === "number" ? d.altitude : 420) / EARTH_KM;
      iss.target.copy(llToVec(d.latitude, d.longitude, R));
      if (!iss.ready) { iss.cur.copy(iss.target); iss.ready = true; }
      iss.trailPts.push(iss.target.clone());
      if (iss.trailPts.length > ISS_TRAIL_MAX) iss.trailPts.shift();
      iss.data = d;
      iss.failed = 0;
    } catch (e) {
      iss.failed++;
    } finally {
      iss.busy = false;
    }
  }

  function issText() {
    const d = iss.data;
    if (!d) return iss.failed >= 2 ? "ISS signal unavailable right now" : "Finding the ISS\u2026";
    const lat = Math.abs(d.latitude).toFixed(1) + "\u00b0" + (d.latitude >= 0 ? "N" : "S");
    const lon = Math.abs(d.longitude).toFixed(1) + "\u00b0" + (d.longitude >= 0 ? "E" : "W");
    const alt = Math.round(d.altitude) + " km";
    const spd = Math.round(d.velocity).toLocaleString("en-US") + " km/h";
    const stale = iss.failed >= 3 ? " (last known)" : "";
    return "ISS " + lat + " " + lon + " \u00b7 " + alt + " \u00b7 " + spd + stale;
  }

  let issTextLast = "";
  function updateIss(dt) {
    if (!iss.pts) return;
    const want = state.iss && state.view !== "moon" && state.view !== "mars";
    state.issMix += ((want ? 1 : 0) - state.issMix) * Math.min(1, dt * 6);
    const show = want && iss.ready;
    iss.pts.visible = iss.trail.visible = show;
    if (iss.anchor) iss.anchor.visible = show;
    if (issReadout) {
      const t = want ? issText() : "";
      if (t !== issTextLast) { issReadout.textContent = t; issTextLast = t; }
      issReadout.hidden = !want;
    }
    if (!show) return;

    // glide toward the newest fix, staying on the orbit shell
    const R = iss.target.length();
    iss.cur.lerp(iss.target, 1 - Math.exp(-dt * 2.2)).setLength(R);
    if (iss.anchor) iss.anchor.position.copy(iss.cur);
    const pa = iss.pts.geometry.attributes.position;
    pa.setXYZ(0, iss.cur.x, iss.cur.y, iss.cur.z);
    pa.needsUpdate = true;

    const ta = iss.trailGeo.attributes.position;
    let n = 0;
    for (const v of iss.trailPts) { ta.setXYZ(n++, v.x, v.y, v.z); }
    ta.setXYZ(n++, iss.cur.x, iss.cur.y, iss.cur.z);
    ta.needsUpdate = true;
    iss.trailGeo.setDrawRange(0, n);
  }

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);

    // Intro dolly-in
    state.intro = Math.min(1, state.intro + dt / (reduceMotion ? 0.01 : 2.6));
    const introZoom = 1 + (1 - easeOut(state.intro)) * 0.9;

    // Smooth zoom
    state.zoom += (state.targetZoom - state.zoom) * Math.min(1, dt * 6);

    // Rotation: inertia, auto-rotate, or reset tween
    if (state.resetting) {
      const k = Math.min(1, dt * 4);
      let diff = START_ROT_Y - earthGroup.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      earthGroup.rotation.y += diff * k;
      earthGroup.rotation.x += (START_ROT_X - earthGroup.rotation.x) * k;
      let odiff = -orbitGroup.rotation.y;
      odiff = Math.atan2(Math.sin(odiff), Math.cos(odiff));
      orbitGroup.rotation.y += odiff * k;
      orbitGroup.rotation.x += (START_ROT_X - orbitGroup.rotation.x) * k;
      let md = START_MARS_Y - marsGroup.rotation.y;
      md = Math.atan2(Math.sin(md), Math.cos(md));
      marsGroup.rotation.y += md * k;
      marsGroup.rotation.x += (MARS_TILT - marsGroup.rotation.x) * k;
      let mo = -marsOrbitGroup.rotation.y;
      mo = Math.atan2(Math.sin(mo), Math.cos(mo));
      marsOrbitGroup.rotation.y += mo * k;
      marsOrbitGroup.rotation.x += (MARS_TILT - marsOrbitGroup.rotation.x) * k;
      let cy = -state.camYaw;
      cy = Math.atan2(Math.sin(cy), Math.cos(cy));
      state.camYaw += cy * k;
      state.camPitch += ((state.view === "moon" ? 0.2 : 0) - state.camPitch) * k;
      if (Math.abs(diff) < 0.002) state.resetting = false;
    } else if (!state.dragging && state.fly) {
      const f = state.fly, k = Math.min(1, dt * 3.2);
      let dy = f.y - earthGroup.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const dx = f.x - earthGroup.rotation.x;
      const done = Math.abs(dy) < 0.0015 && Math.abs(dx) < 0.0015;
      rotateBy(done ? dy : dy * k, done ? dx : dx * k);
      state.velX = state.velY = 0;
      if (done) state.fly = null;
    } else if (!state.dragging) {
      rotateBy(state.velY, state.velX);
      state.velY *= 0.95;
      state.velX *= 0.95;
      if (state.autoRotate && !state.city && !reduceMotion) {
        if (state.view === "mars") marsGroup.rotation.y += dt * 0.09;
        else earthGroup.rotation.y += dt * 0.09;
      }
    }

    // Clouds drift a touch faster than the ground
    if (cloudMesh && !reduceMotion) cloudMesh.rotation.y += dt * 0.006;

    // Toggles
    const nightTarget = state.night ? 1 : 0;
    state.nightMix += (nightTarget - state.nightMix) * Math.min(1, dt * 5);
    earthMat.uniforms.uNight.value = state.nightMix;
    cloudMat.uniforms.uNight.value = state.nightMix;
    atmoMat.uniforms.uNight.value = state.nightMix;
    const co = cloudMat.uniforms.uOpacity;
    co.value += ((state.clouds ? 1 : 0) - co.value) * Math.min(1, dt * 6);
    cloudMesh.visible = co.value > 0.01;

    // Orbits fade/scale in and out
    const wantOrbits = state.view === "moon" ? true : state.view === "mars" ? false : state.orbits;
    state.orbitMix += ((wantOrbits ? 1 : 0) - state.orbitMix) * Math.min(1, dt * 4);

    // Earth shrinks away in Moon view and returns otherwise
    state.earthPresence += ((state.view === "moon" || state.view === "mars" ? 0 : 1) - state.earthPresence) * Math.min(1, dt * 5);
    const ep = state.earthPresence;
    const epScale = Math.max(ep, 0.001);
    earthGroup.visible = atmoMesh.visible = ep > 0.01;
    earthGroup.scale.setScalar(epScale);
    atmoMesh.scale.setScalar(epScale);
    for (const p of earthPivots) {
      p.visible = ep > 0.01;
      p.scale.setScalar(epScale);
    }
    // Mars and its orbits
    state.marsPresence += ((state.view === "mars" ? 1 : 0) - state.marsPresence) * Math.min(1, dt * 5);
    const mp = state.marsPresence;
    marsGroup.visible = marsAtmoMesh.visible = mp > 0.01;
    marsGroup.scale.setScalar(Math.max(mp, 0.001));
    marsAtmoMesh.scale.setScalar(Math.max(mp, 0.001));
    const wantMarsOrbits = state.view === "mars" && state.orbits;
    state.marsOrbitMix += ((wantMarsOrbits ? 1 : 0) - state.marsOrbitMix) * Math.min(1, dt * 4);
    marsOrbitGroup.visible = state.marsOrbitMix > 0.01;
    marsOrbitGroup.scale.setScalar(0.55 + 0.45 * state.marsOrbitMix);

    // The Moon's big path around Earth only makes sense when Earth is shown
    moonRing.visible = moonTrailLine.visible = state.view !== "moon";
    // The Moon's whole system fades out in Earth-only view, while Earth's own orbits stay
    state.moonPresence += ((state.view === "earth" ? 0 : 1) - state.moonPresence) * Math.min(1, dt * 5);
    moonPivotRef.visible = state.moonPresence > 0.01;
    moonPivotRef.scale.setScalar(Math.max(state.moonPresence, 0.001));
    orbitGroup.visible = state.orbitMix > 0.01;
    orbitGroup.scale.setScalar(0.55 + 0.45 * state.orbitMix);
    updateOrbits(dt);
    updateIss(dt);

    updateRocketFx();
    updateTrip(dt);
    updateBlasts(dt);

    // Camera
    const ct = camTargets();
    const kc = Math.min(1, dt * 4);
    state.camR += (ct.R - state.camR) * kc;
    state.camD += (ct.D - state.camD) * kc;
    // Follow the focus exactly (the offset decays), so a moving Moon never makes the view lag or jitter
    getFocusTarget(state.view, _ft);
    state.focusOff.multiplyScalar(Math.exp(-dt * 5));
    state.focus.copy(_ft).add(state.focusOff);

    if (state.view !== "moon") {
      const kd = Math.min(1, dt * 4);
      state.camYaw = Math.atan2(Math.sin(state.camYaw), Math.cos(state.camYaw)) * (1 - kd);
      state.camPitch *= 1 - kd;
    }
    const dist = baseDistance() * state.zoom * introZoom;
    const cp = Math.cos(state.camPitch);
    camera.position.set(
      state.focus.x + dist * Math.sin(state.camYaw) * cp,
      state.focus.y + dist * Math.sin(state.camPitch),
      state.focus.z + dist * Math.cos(state.camYaw) * cp
    );
    camera.lookAt(state.focus);
    if (state.shake > 0.0005) { // a little camera shake when something blows up
      camera.position.x += (Math.random() - 0.5) * state.shake;
      camera.position.y += (Math.random() - 0.5) * state.shake;
      state.shake *= Math.exp(-dt * 6);
    }

    updateLabels();

    stars.rotation.y += dt * 0.004;

    renderer.render(scene, camera);
  }

  // If anything goes wrong, say so on screen instead of hanging on "Unpacking the planet"
  function showFatal(e) {
    console.error(e);
    const msg = (e && e.message) ? e.message : String(e);
    const p = loaderEl.querySelector("p");
    if (p) p.textContent = "Something broke: " + msg + " (press F12 and open Console for details)";
    const ring = loaderEl.querySelector(".loader-ring");
    if (ring) ring.style.display = "none";
    loaderEl.classList.remove("done");
  }
  window.addEventListener("error", (ev) => { if (!loaderEl.classList.contains("done")) showFatal(ev.error || ev.message); });
  loadEpic();
  init().catch(showFatal);
})();
