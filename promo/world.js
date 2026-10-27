// 3D-„Knetwelt“ für den Werbespot: kleine Stadt am See (frei nach Bregenz) in Bier-Farben.
// Alles ist deterministisch (fester Zufallsstartwert), damit jedes Rendern gleich aussieht.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const C = {
  ground: 0xf3e6cc, street: 0xe6d4b2, building: 0xfff8ec, roofA: 0xfbefd9, roofB: 0xf6e4c4,
  tree: 0xc9dea8, treeDark: 0xb3cf8e, trunk: 0xc9a77c, water: 0xbfdde2, sand: 0xf0dfbd,
  amber: 0xf2a01c, amberDark: 0xdf8510, foam: 0xfff7e6, route: 0xe0531f, user: 0x2f7fc1,
  green: 0x3e9a52, blue: 0x2f7fc1, brew: 0xb4532a,
};
export const CELL = 10, STREET = 2.6;

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });

// Stecknadel im Logo-Stil: Spitze bei y=0, Kopf (Radius r) oben. foam = cremefarbene Schaumkappe.
export function makePin({ color = C.amber, r = 1, foam = true, ring = false } = {}) {
  const g = new THREE.Group();
  const h = 2.1 * r; // Kopfmitte über der Spitze
  const pts = [];
  const a = Math.asin(r / h); // Tangentenwinkel
  pts.push(new THREE.Vector2(0, 0));
  for (let i = 0; i <= 24; i++) { // vom Tangentenpunkt über den Kopf bis ganz oben
    const ang = -a + (Math.PI / 2 + a) * (i / 24);
    pts.push(new THREE.Vector2(Math.cos(ang) * r, h + Math.sin(ang) * r));
  }
  pts[pts.length - 1].x = 0;
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat(color));
  body.castShadow = true;
  g.add(body);
  if (foam) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.03, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(C.foam));
    cap.position.y = h; cap.castShadow = true;
    g.add(cap);
    for (const [x, z, s] of [[-0.45, 0.25, 0.32], [-0.05, -0.1, 0.22]]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r * s, 20, 12), mat(C.foam));
      b.position.set(x * r, h + r * 1.08, z * r); b.castShadow = true;
      g.add(b);
    }
  }
  if (ring) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 24, 16), mat(0xffffff));
    dot.position.set(0, h, r * 0.75);
    g.add(dot);
  }
  g.userData.height = h + r;
  return g;
}

export function createWorld(canvas, { width = 1080, height = 1920 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6ead2);
  scene.fog = new THREE.Fog(0xf6ead2, 90, 230);

  const camera = new THREE.PerspectiveCamera(28, width / height, 0.5, 600);

  scene.add(new THREE.HemisphereLight(0xfff6e6, 0xd9c09a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 220 });
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const R = rng(4711);
  const world = new THREE.Group();
  scene.add(world);

  // Boden, Straßen, See
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(C.street));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  world.add(ground);
  const LAKE_Z = -46;
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), mat(C.water));
  lake.rotation.x = -Math.PI / 2; lake.position.set(0, 0.05, LAKE_Z - 150); lake.receiveShadow = true;
  world.add(lake);
  const shore = new THREE.Mesh(new RoundedBoxGeometry(600, 0.4, 6, 2, 0.15), mat(C.sand));
  shore.position.set(0, 0.1, LAKE_Z + 2); shore.receiveShadow = true;
  world.add(shore);

  const special = {};
  const trees = [];
  const addTree = (x, z, s = 1) => {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.24 * s, 1.2 * s, 10), mat(C.trunk));
    trunk.position.y = 0.6 * s; trunk.castShadow = true;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.0 * s, 20, 14), mat(R() < 0.5 ? C.tree : C.treeDark));
    crown.position.y = 1.9 * s; crown.castShadow = true; crown.receiveShadow = true;
    t.add(trunk, crown); t.position.set(x, 0, z);
    world.add(t); trees.push(t);
    return t;
  };
  const box = (w, h, d, color, x, z, y = 0, radius = 0.35) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, h / 2 - 0.01, w / 2 - 0.01, d / 2 - 0.01)), mat(color));
    m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true;
    world.add(m);
    return m;
  };

  // Promenade mit Bäumen am See
  for (let x = -120; x <= 120; x += 6) addTree(x + R() * 2, LAKE_Z + 6.5 + R(), 0.9 + R() * 0.3);

  const B = CELL - STREET; // Blockgröße
  const SPECIAL = {
    '1,-1': 'pub', '-2,1': 'shop', '2,2': 'garden', '-3,-2': 'brewery', '0,0': 'park', '-1,3': 'park', '4,-1': 'park',
  };
  for (let i = -9; i <= 9; i++) {
    for (let j = -4; j <= 9; j++) {
      const cx = i * CELL, cz = j * CELL;
      // Gehsteig-Sockel
      const base = box(B, 0.25, B, C.ground, cx, cz, 0, 0.6);
      base.castShadow = false;
      const kind = SPECIAL[`${i},${j}`];
      if (kind === 'park') {
        for (let k = 0; k < 5; k++) addTree(cx + (R() - 0.5) * (B - 2), cz + (R() - 0.5) * (B - 2), 0.8 + R() * 0.5);
        continue;
      }
      if (kind === 'garden') {
        // Biergarten: Bäume, Bänke, Sonnenschirme
        for (const [dx, dz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) addTree(cx + dx, cz + dz, 1.1);
        for (const [dx, dz] of [[0, -1.2], [0, 1.2]]) {
          box(3.2, 0.7, 0.9, 0xd8b98c, cx + dx, cz + dz, 0.25, 0.15);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), mat(0xffffff));
          pole.position.set(cx + dx, 1.35, cz + dz); world.add(pole);
          const umb = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 24), mat(C.green));
          umb.position.set(cx + dx, 2.5, cz + dz); umb.castShadow = true; world.add(umb);
        }
        special.garden = new THREE.Vector3(cx, 0, cz);
        continue;
      }
      if (kind === 'pub') {
        const m = box(B * 0.8, 3.4, B * 0.7, C.building, cx, cz, 0.25);
        box(B * 0.6, 0.35, 1.1, C.amber, cx, cz + B * 0.35 + 0.3, 2.0, 0.15); // Markise
        box(1.1, 1.8, 0.2, C.amberDark, cx, cz + B * 0.35 + 0.05, 0.25, 0.08); // Tür
        special.pub = { pos: new THREE.Vector3(cx, 3.65, cz), mesh: m };
        continue;
      }
      if (kind === 'shop') {
        const m = box(B * 0.92, 2.4, B * 0.75, C.building, cx, cz, 0.25);
        box(B * 0.92 + 0.05, 0.5, 0.3, C.blue, cx, cz + B * 0.375, 1.9, 0.12); // Schild
        special.shop = { pos: new THREE.Vector3(cx, 2.65, cz), mesh: m };
        continue;
      }
      if (kind === 'brewery') {
        box(B * 0.8, 3, B * 0.6, C.building, cx - 0.6, cz, 0.25);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.2, 28), mat(0xe0a060));
        tank.position.set(cx + 2.4, 2.35, cz + 1.8); tank.castShadow = true; world.add(tank);
        const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 7, 16), mat(0xe9c9a0));
        chim.position.set(cx - 2.2, 3.75, cz - 1.5); chim.castShadow = true; world.add(chim);
        special.brewery = { pos: new THREE.Vector3(cx, 3.25, cz) };
        continue;
      }
      // normale Häuser: 1–4 Gebäude je Block
      const split = R();
      const lots = split < 0.25 ? [[0, 0, B * 0.86, B * 0.86]]
        : split < 0.6 ? [[-B * 0.23, 0, B * 0.42, B * 0.86], [B * 0.23, 0, B * 0.42, B * 0.86]]
          : [[-B * 0.23, -B * 0.23, B * 0.42, B * 0.42], [B * 0.23, -B * 0.23, B * 0.42, B * 0.42], [-B * 0.23, B * 0.23, B * 0.42, B * 0.42], [B * 0.23, B * 0.23, B * 0.42, B * 0.42]];
      const dist = Math.hypot(i, j);
      for (const [dx, dz, w, d] of lots) {
        if (R() < 0.12) { addTree(cx + dx, cz + dz, 0.8); continue; }
        const h = 1.4 + R() * 3.2 + (dist < 3 ? R() * 2.2 : 0);
        box(w, h, d, R() < 0.5 ? C.building : (R() < 0.5 ? C.roofA : C.roofB), cx + dx, cz + dz, 0.25);
      }
    }
  }

  // Pin-Vorlagen
  const pins = new THREE.Group();
  world.add(pins);

  // Standortpunkt (blau) mit Puls-Ring
  const user = new THREE.Group();
  const udot = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), mat(C.user));
  udot.position.y = 0.55; udot.castShadow = true;
  const uring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  uring.rotation.x = -Math.PI / 2; uring.position.y = 0.06;
  const pulse = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: C.user, transparent: true, opacity: 0.25, depthWrite: false }));
  pulse.rotation.x = -Math.PI / 2; pulse.position.y = 0.05;
  user.add(pulse, uring, udot);
  user.position.set(CELL / 2, 0, CELL / 2);
  world.add(user);

  // Radroute: Polyline über Kreuzungen, gerundet
  const S = CELL / 2;
  const routePts = [[S, S], [S + 20, S], [S + 20, S - 20], [S - 30, S - 20], [S - 30, S + 20], [S + 10, S + 20], [S + 10, S]]
    .map(([x, z]) => new THREE.Vector3(x, 0.45, z));
  const curve = new THREE.CurvePath();
  for (let k = 0; k < routePts.length - 1; k++) curve.add(new THREE.LineCurve3(routePts[k], routePts[k + 1]));
  const SEG = 600;
  const pts = curve.getSpacedPoints(SEG);
  const smooth = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.1);
  const routeGeo = new THREE.TubeGeometry(smooth, SEG, 0.7, 10, false);
  const route = new THREE.Mesh(routeGeo, mat(C.route));
  route.castShadow = true;
  world.add(route);
  // geplanter Weg, noch nicht gefahren: halbtransparent
  const ghost = new THREE.Mesh(new THREE.TubeGeometry(smooth, SEG, 0.55, 10, false), new THREE.MeshStandardMaterial({ color: C.route, transparent: true, opacity: 0.35, roughness: 1, depthWrite: false }));
  world.add(ghost);
  const routeIndexPerSeg = 10 * 6;
  const setRoute = p => routeGeo.setDrawRange(0, Math.floor(clamp01(p) * SEG) * routeIndexPerSeg);
  setRoute(0);
  const bike = new THREE.Group();
  const bdot = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16), mat(0xffffff));
  const bcore = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), mat(C.route));
  bdot.castShadow = true; bdot.position.y = 0.8; bcore.position.y = 0.8; bcore.scale.setScalar(1.05);
  bike.add(bdot); bdot.add(bcore); bcore.position.set(0, 0, 0);
  world.add(bike);

  return { THREE, renderer, scene, camera, world, sun, user, pulse, pins, special, route: { curve: smooth, set: setRoute, mesh: route, ghost }, bike, trees, LAKE_Z };
}

export const clamp01 = x => Math.min(1, Math.max(0, x));
