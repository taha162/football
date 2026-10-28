import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  Scene,
  Shape,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
  type IUniform,
  type Material,
  type ShaderMaterial,
  type Texture,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BALL, GOAL, PITCH, SURFACES } from "@/lib/stage/physics";
import type { TierSettings } from "@/lib/stage/quality";
import {
  ballMaterial,
  ballShadowUniforms,
  beamMaterial,
  distantLightsMaterial,
  dustMaterial,
  flagMaterial,
  grassMaterial,
  netMaterial,
  pitchMaterial,
  skyMaterial,
  standMaterial,
} from "./materials";
import { boardTexture, glowTexture, labelTexture, streakTexture, type BoardItem } from "./textures";

export type PositionKey = "goalkeeper" | "defender" | "midfielder" | "forward";

export interface MarkerSpec {
  position: PositionKey;
  /** Position name, already localised. */
  title: string;
  /** Real figure for the position, already localised (e.g. "3 teams looking"). */
  detail: string;
}

export interface WorldOptions {
  tier: TierSettings;
  /** Arabic (RTL) composes every shot as the mirror image, so text and subject swap sides. */
  rtl: boolean;
  fonts: { arabic: string; latin: string };
  markers: MarkerSpec[];
  pixelRatio: number;
}

export interface TowerRig {
  lampPos: Vector3;
  /** Unit vector the lamp bank faces. */
  normal: Vector3;
  aim: Vector3;
  light: SpotLight;
  lamps: Mesh<BufferGeometry, MeshBasicMaterial>;
  halo: Sprite;
  core: Sprite;
  streak: Sprite | null;
  beams: Mesh<BufferGeometry, ShaderMaterial>[];
  beamMaterial: ShaderMaterial;
}

export interface MarkerRig {
  position: PositionKey;
  center: Vector3;
  ring: Mesh<BufferGeometry, MeshBasicMaterial>;
  disc: Mesh<BufferGeometry, MeshBasicMaterial>;
  label: Mesh<BufferGeometry, MeshBasicMaterial>;
}

export interface World {
  scene: Scene;
  towers: TowerRig[];
  hemi: HemisphereLight;
  ball: Mesh;
  ballMaterial: Material;
  shadowUniforms: Record<string, IUniform>;
  grass: InstancedMesh | null;
  grassUniforms: Record<string, IUniform> | null;
  dust: Points;
  dustMaterial: ShaderMaterial;
  boards: MeshBasicMaterial;
  boardTextures: { brand: Texture; tournament: Texture };
  roofLights: MeshBasicMaterial;
  netUniforms: Record<string, IUniform>;
  flagUniforms: Record<string, IUniform>;
  markers: MarkerRig[];
  formation: Mesh<BufferGeometry, MeshBasicMaterial>;
  sky: ShaderMaterial;
  distant: ShaderMaterial;
  dispose(): void;
}

/* ------------------------------------------------------------------------
   Layout (metres). The pitch is centred on the origin, length along x.
   ------------------------------------------------------------------------ */
const BOARD_X = PITCH.halfLength + SURFACES.boards.inset; // 56.5
const BOARD_Z = PITCH.halfWidth + SURFACES.boards.inset; // 38
const TOWER = { x: 64, z: 47, height: 40 };
export const LAMP_COLOR = new Color("#f2f6ff"); // cool-white LED floodlights
/** Luminous intensity of one tower (cd); with four towers this gives a well-lit pitch at exposure 1. */
export const TOWER_CANDELA = 17000;

const UP = new Vector3(0, 1, 0);

function along(geometry: BufferGeometry, a: Vector3, b: Vector3) {
  const dir = new Vector3().subVectors(b, a);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  geometry.translate(mid.x, mid.y, mid.z);
  return geometry;
}
/** A round tube between two points. */
const rod = (a: Vector3, b: Vector3, r: number, radial = 12) => along(new CylinderGeometry(r, r, a.distanceTo(b), radial, 1), a, b);
/** A square steel member between two points. */
const member = (a: Vector3, b: Vector3, t: number) => along(new BoxGeometry(t, a.distanceTo(b), t), a, b);

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error("stage: geometry merge failed");
  return merged;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/* ------------------------------------------------------------------------ */

export function buildWorld(o: WorldOptions): World {
  const m = o.rtl ? -1 : 1;
  const scene = new Scene();
  scene.fog = new FogExp2(new Color("#070a08"), 0.0026);
  const textures: Texture[] = [];
  const track = <T extends Texture>(t: T) => (textures.push(t), t);

  /* ---- Sky, stars and the city on the horizon ------------------------- */
  const sky = skyMaterial();
  const skyMesh = new Mesh(new SphereGeometry(460, 32, 16), sky);
  skyMesh.renderOrder = -10;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);

  const distant = distantLightsMaterial(o.pixelRatio);
  {
    const pos: number[] = [];
    const col: number[] = [];
    const seed: number[] = [];
    const rand = mulberry32(7);
    // Stars: few, as over any city.
    for (let i = 0; i < 380; i++) {
      const az = rand() * Math.PI * 2;
      const sinEl = 0.22 + rand() * 0.78;
      const cosEl = Math.sqrt(1 - sinEl * sinEl);
      const r = 430;
      pos.push(Math.cos(az) * cosEl * r, sinEl * r, Math.sin(az) * cosEl * r);
      const b = 0.18 + rand() * rand() * 0.6;
      col.push(b * 0.9, b * 0.95, b);
      seed.push(rand(), rand() * 0.6);
    }
    // City lights beyond the stands: warm sodium with some white, denser in clusters.
    for (let i = 0; i < 1500; i++) {
      const az = rand() * Math.PI * 2;
      const cluster = 0.5 + 0.5 * Math.sin(az * 5 + 1.3) * Math.sin(az * 3.1);
      if (rand() > 0.35 + 0.65 * cluster) continue;
      const r = 210 + rand() * 210;
      const y = 0.6 + rand() * rand() * 16;
      pos.push(Math.cos(az) * r, y, Math.sin(az) * r);
      const warm = rand() < 0.72;
      const b = 0.35 + rand() * 0.9;
      if (warm) col.push(1.0 * b, 0.6 * b, 0.28 * b);
      else col.push(0.85 * b, 0.92 * b, 1.0 * b);
      seed.push(rand(), 0.2 + rand() * 0.8);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new Float32BufferAttribute(col, 3));
    g.setAttribute("aSeed", new Float32BufferAttribute(seed, 2));
    const points = new Points(g, distant);
    points.frustumCulled = false;
    points.renderOrder = -9;
    scene.add(points);
  }

  /* ---- Pitch ------------------------------------------------------------ */
  const shadowUniforms = ballShadowUniforms();
  const pitchGeo = new PlaneGeometry(170, 130, 1, 1);
  pitchGeo.rotateX(-Math.PI / 2);
  const pitch = new Mesh(pitchGeo, pitchMaterial(shadowUniforms));
  pitch.receiveShadow = true;
  scene.add(pitch);

  /* ---- Grass blades around the centre spot ------------------------------ */
  let grass: InstancedMesh | null = null;
  let grassUniforms: Record<string, IUniform> | null = null;
  if (o.tier.grass > 0) {
    const g = grassMaterial(shadowUniforms);
    grassUniforms = g.uniforms;
    grass = new InstancedMesh(bladeGeometry(), g.material, o.tier.grass);
    const rand = mulberry32(11);
    const dummy = new Object3D();
    const c = new Color();
    const radius = 3.4;
    for (let i = 0; i < o.tier.grass; i++) {
      const r = radius * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const edge = 1 - smooth(radius * 0.55, radius, r);
      const h = (0.035 + rand() * 0.04) * (0.08 + 0.92 * edge);
      dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(0.0045 + rand() * 0.003, h, h);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
      // Linear-space greens: mostly fresh, some yellowed tips and darker shoots.
      const t = rand();
      c.setRGB(0.03 + 0.05 * t * t, 0.12 + 0.1 * t, 0.025 + 0.02 * t);
      if (rand() < 0.08) c.setRGB(0.09, 0.14, 0.04);
      grass.setColorAt(i, c);
    }
    grass.instanceMatrix.needsUpdate = true;
    grass.receiveShadow = true;
    grass.castShadow = false;
    scene.add(grass);
  }

  /* ---- Ball ------------------------------------------------------------- */
  const ballMat = ballMaterial();
  const ball = new Mesh(new SphereGeometry(BALL.radius, o.tier.ballSegments, o.tier.ballSegments / 2), ballMat);
  ball.position.set(0, BALL.radius, 0);
  ball.castShadow = false; // the analytic floodlight shadows draw it, four times over
  scene.add(ball);

  /* ---- Goals: frame, back supports and nets ----------------------------- */
  const net = netMaterial();
  {
    const white: BufferGeometry[] = [];
    const steel: BufferGeometry[] = [];
    const nets: BufferGeometry[] = [];
    const zp = GOAL.halfWidth + GOAL.postRadius;
    const top = GOAL.height + GOAL.postRadius;
    for (const s of [-1, 1]) {
      const x = s * PITCH.halfLength;
      const xb = s * (PITCH.halfLength + GOAL.depth);
      white.push(rod(v(x, 0, -zp), v(x, top, -zp), GOAL.postRadius, 20), rod(v(x, 0, zp), v(x, top, zp), GOAL.postRadius, 20));
      white.push(rod(v(x, top, -zp - GOAL.postRadius), v(x, top, zp + GOAL.postRadius), GOAL.postRadius, 20));
      const r = 0.024;
      const w = GOAL.halfWidth;
      const h = GOAL.height;
      steel.push(
        rod(v(x, r, -w), v(xb, r, -w), r),
        rod(v(x, r, w), v(xb, r, w), r),
        rod(v(xb, r, -w), v(xb, r, w), r),
        rod(v(xb, 0, -w), v(xb, h, -w), r),
        rod(v(xb, 0, w), v(xb, h, w), r),
        rod(v(xb, h, -w), v(xb, h, w), r),
        rod(v(x, h, -w), v(xb, h, -w), r),
        rod(v(x, h, w), v(xb, h, w), r),
      );
      // Net panels match the physics panels exactly; each normal points out of the goal.
      const back = new PlaneGeometry(GOAL.halfWidth * 2, GOAL.height, 28, 10);
      back.rotateY((s * Math.PI) / 2);
      back.translate(xb, GOAL.height / 2, 0);
      nets.push(back);
      for (const side of [-1, 1]) {
        const p = new PlaneGeometry(GOAL.depth, GOAL.height, 8, 10);
        if (side < 0) p.rotateY(Math.PI);
        p.translate(s * (PITCH.halfLength + GOAL.depth / 2), GOAL.height / 2, side * GOAL.halfWidth);
        nets.push(p);
      }
      const roof = new PlaneGeometry(GOAL.depth, GOAL.halfWidth * 2, 8, 28);
      roof.rotateX(Math.PI / 2);
      roof.translate(s * (PITCH.halfLength + GOAL.depth / 2), GOAL.height, 0);
      nets.push(roof);
    }
    const frame = new Mesh(merge(white), new MeshStandardMaterial({ color: new Color("#f4f6f2"), roughness: 0.32, metalness: 0.05 }));
    frame.castShadow = true;
    scene.add(frame);
    const supports = new Mesh(merge(steel), new MeshStandardMaterial({ color: new Color("#5d6560"), roughness: 0.5, metalness: 0.6 }));
    supports.castShadow = true;
    scene.add(supports);
    const netMesh = new Mesh(merge(nets), net.material);
    netMesh.renderOrder = 2;
    scene.add(netMesh);
  }

  /* ---- Corner flags ----------------------------------------------------- */
  const flag = flagMaterial();
  {
    const poles: BufferGeometry[] = [];
    const cloths: BufferGeometry[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * PITCH.halfLength;
        const z = sz * PITCH.halfWidth;
        poles.push(rod(v(x, 0, z), v(x, 1.55, z), 0.016));
        const c = new PlaneGeometry(0.42, 0.3, 10, 2);
        c.translate(0.21, 0, 0); // hinge at the pole
        c.rotateY(sx > 0 ? Math.PI : 0); // flags point back over the pitch
        c.translate(x, 1.38, z);
        cloths.push(c);
      }
    const p = new Mesh(merge(poles), new MeshStandardMaterial({ color: new Color("#e9ece6"), roughness: 0.5 }));
    p.castShadow = true;
    scene.add(p);
    scene.add(new Mesh(merge(cloths), flag.material));
  }

  /* ---- Advertising boards (LED) ----------------------------------------- */
  const brandItems: BoardItem[] = [
    { text: "MALAAB", kind: "display" },
    { text: "·", kind: "dot" },
    { text: "ملعب", kind: "display" },
    { text: "·", kind: "dot" },
    { text: "الموصل", kind: "body" },
    { text: "·", kind: "dot" },
    { text: "MOSUL", kind: "body" },
    { text: "·", kind: "dot" },
  ];
  const tournamentItems: BoardItem[] = [
    { text: "TOURNAMENT NIGHT", kind: "display" },
    { text: "·", kind: "dot" },
    { text: "ليلة البطولة", kind: "display" },
    { text: "·", kind: "dot" },
    { text: "MALAAB", kind: "body" },
    { text: "·", kind: "dot" },
  ];
  const brand = track(boardTexture(brandItems, o.fonts));
  const tournament = track(boardTexture(tournamentItems, o.fonts));
  const boards = new MeshBasicMaterial({ map: brand, color: new Color(0, 0, 0) });
  {
    const H = SURFACES.boards.height;
    const metresPerRepeat = H * (2048 / 96);
    const faces: BufferGeometry[] = [];
    const backs: BufferGeometry[] = [];
    const runs: { len: number; rotY: number; at: Vector3 }[] = [
      { len: BOARD_X * 2, rotY: 0, at: v(0, H / 2, -BOARD_Z) },
      { len: BOARD_X * 2, rotY: Math.PI, at: v(0, H / 2, BOARD_Z) },
      { len: BOARD_Z * 2, rotY: -Math.PI / 2, at: v(BOARD_X, H / 2, 0) },
      { len: BOARD_Z * 2, rotY: Math.PI / 2, at: v(-BOARD_X, H / 2, 0) },
    ];
    for (const r of runs) {
      const f = new PlaneGeometry(r.len, H);
      const uv = f.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (r.len / metresPerRepeat));
      f.rotateY(r.rotY);
      f.translate(r.at.x, r.at.y, r.at.z);
      faces.push(f);
      const b = new BoxGeometry(r.len, H + 0.08, 0.22);
      b.translate(0, 0, -0.12);
      b.rotateY(r.rotY);
      b.translate(r.at.x, r.at.y, r.at.z);
      backs.push(b);
    }
    scene.add(new Mesh(merge(faces), boards));
    const housing = new Mesh(merge(backs), new MeshStandardMaterial({ color: new Color("#0b0d0c"), roughness: 0.6, metalness: 0.3 }));
    housing.castShadow = true;
    scene.add(housing);
  }

  /* ---- Stands, roofs and their lights ----------------------------------- */
  const roofLights = new MeshBasicMaterial({ color: new Color(0, 0, 0) });
  {
    const standMat = standMaterial();
    const long = standGeometry(16, PITCH.halfLength * 2 - 5);
    const end = standGeometry(10, PITCH.halfWidth * 2 - 8);
    const place = (g: BufferGeometry, rotY: number, x: number, z: number) => {
      const mesh = new Mesh(g, standMat);
      mesh.rotation.y = rotY;
      mesh.position.set(x, 0, z);
      mesh.receiveShadow = true;
      scene.add(mesh);
    };
    const halfLong = (PITCH.halfLength * 2 - 5) / 2;
    const halfEnd = (PITCH.halfWidth * 2 - 8) / 2;
    place(long, -Math.PI / 2, halfLong, BOARD_Z + 4);
    place(long, Math.PI / 2, -halfLong, -(BOARD_Z + 4));
    place(end, 0, BOARD_X + 6, -halfEnd);
    place(end, Math.PI, -(BOARD_X + 6), halfEnd);

    // Cantilevered roofs over both long stands, columns at the back, a row of lights under the front edge.
    const roofParts: BufferGeometry[] = [];
    const lightParts: BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const front = s * (BOARD_Z + 3);
      const back = s * (BOARD_Z + 4 + 14.6);
      const roof = new BoxGeometry(halfLong * 2 + 6, 0.45, Math.abs(back - front) + 1);
      roof.rotateX(-s * 0.05);
      roof.translate(0, 16, (front + back) / 2);
      roofParts.push(roof);
      for (let x = -halfLong; x <= halfLong + 0.1; x += 12.5) roofParts.push(rod(v(x, 0, back - s * 0.6), v(x, 16, back - s * 0.6), 0.32, 10));
      for (let x = -halfLong + 2; x <= halfLong - 2 + 0.1; x += 4) {
        const l = new BoxGeometry(1.2, 0.08, 0.22);
        l.translate(x, 15.5, front + s * 0.8);
        lightParts.push(l);
      }
    }
    const roofs = new Mesh(merge(roofParts), new MeshStandardMaterial({ color: new Color("#141816"), roughness: 0.7, metalness: 0.4 }));
    roofs.receiveShadow = true;
    scene.add(roofs);
    scene.add(new Mesh(merge(lightParts), roofLights));
  }

  /* ---- Floodlight towers -------------------------------------------------- */
  const glow = track(glowTexture());
  const streakTex = track(streakTexture());
  const steelParts: BufferGeometry[] = [];
  // The key tower (index 0, the one that switches on first and casts shadows)
  // stands high on the right of the opening shot; the closing shot looks the
  // other way, at tower 3. In Arabic the whole composition mirrors.
  const corners: [number, number][] = [
    [1, m],
    [-1, m],
    [1, -m],
    [-1, -m],
  ];
  const towers: TowerRig[] = corners.map(([sx, sz], index) => {
    const base = v(sx * TOWER.x, 0, sz * TOWER.z);
    steelParts.push(...latticeMast(base, TOWER.height));
    const aim = v(-10.2 * sx, 0, -8.9 * sz);
    const lampPos = v(base.x - sx * 1.1, TOWER.height + 1.8, base.z - sz * 1.1);
    const frame = new Object3D();
    frame.position.copy(lampPos);
    frame.lookAt(aim);
    frame.updateMatrixWorld();
    const normal = new Vector3(0, 0, 1).applyQuaternion(frame.quaternion);

    const discs: BufferGeometry[] = [];
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 6; col++) {
        const x = (col - 2.5) * 1.05;
        const y = (row - 1.5) * 1.05;
        const d = new CircleGeometry(0.34, 20);
        d.translate(x, y, 0.13);
        d.applyMatrix4(frame.matrixWorld);
        discs.push(d);
        const h = new BoxGeometry(0.9, 0.9, 0.5);
        h.translate(x, y, -0.15);
        h.applyMatrix4(frame.matrixWorld);
        steelParts.push(h);
      }
    const plate = new BoxGeometry(6.9, 4.7, 0.16);
    plate.translate(0, 0, -0.48);
    plate.applyMatrix4(frame.matrixWorld);
    steelParts.push(plate);
    const lamps = new Mesh(merge(discs), new MeshBasicMaterial({ color: new Color(0, 0, 0) }));
    scene.add(lamps);

    const light = new SpotLight(LAMP_COLOR, 0, 0, 0.82, 0.72, 2);
    light.position.copy(lampPos);
    light.target.position.copy(aim);
    scene.add(light, light.target);
    if (index === 0 && o.tier.shadowMap > 0) {
      light.castShadow = true;
      light.shadow.mapSize.set(o.tier.shadowMap, o.tier.shadowMap);
      light.shadow.camera.near = 30;
      light.shadow.camera.far = 220;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.03;
      light.shadow.radius = 3;
    }

    const sprite = (scale: [number, number], tex: Texture, opacity = 0) => {
      const s = new Sprite(new SpriteMaterial({ map: tex, color: LAMP_COLOR, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity }));
      s.position.copy(lampPos).addScaledVector(normal, 0.8);
      s.scale.set(scale[0], scale[1], 1);
      s.renderOrder = 5;
      scene.add(s);
      return s;
    };
    const halo = sprite([40, 40], glow);
    const core = sprite([10, 10], glow);
    const streak = index === 0 ? sprite([90, 4.5], streakTex) : null;

    const beamMat = beamMaterial();
    const beamAims = o.tier.dust >= 600 ? [aim, v(18 * sx, 0, -4 * sz)] : [aim];
    const beams = beamAims.map((target) => {
      const dir = new Vector3().subVectors(target, lampPos);
      const len = dir.length() * 1.05;
      dir.normalize();
      const geo = new ConeGeometry(Math.tan(0.13), 1, 28, 1, true);
      const mesh = new Mesh(geo, beamMat);
      mesh.scale.setScalar(len);
      mesh.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir);
      mesh.position.copy(lampPos).addScaledVector(dir, len / 2);
      mesh.renderOrder = 4;
      scene.add(mesh);
      return mesh;
    });
    return { lampPos, normal, aim, light, lamps, halo, core, streak, beams, beamMaterial: beamMat };
  });
  const steel = new Mesh(merge(steelParts), new MeshStandardMaterial({ color: new Color("#272c29"), roughness: 0.55, metalness: 0.7 }));
  scene.add(steel);

  const hemi = new HemisphereLight(new Color("#1d2733"), new Color("#0a110b"), 0.25);
  scene.add(hemi);

  /* ---- Dust in the key beam ----------------------------------------------- */
  const dustMat = dustMaterial(o.pixelRatio);
  const key = towers[0];
  dustMat.uniforms.uLightPos.value.copy(key.lampPos);
  dustMat.uniforms.uLightDir.value.subVectors(key.aim, key.lampPos).normalize();
  const dustGeo = new BufferGeometry();
  {
    const n = o.tier.dust;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    const rand = mulberry32(5);
    const axis = new Vector3().subVectors(key.aim, key.lampPos);
    const tmp = new Vector3();
    for (let i = 0; i < n; i++) {
      if (i % 4 === 0) {
        // Around the centre spot, where the camera works.
        tmp.set((rand() - 0.5) * 16, 0.12 + rand() * rand() * 5.5, (rand() - 0.5) * 16);
      } else if (i % 4 !== 3) {
        // Denser just in front of the opening and closing shots' lens.
        tmp.set((rand() - 0.5) * 9, 0.1 + rand() * rand() * 3, (rand() - 0.5) * 7);
      } else {
        // Along the key beam, for the opening shot.
        const f = 0.12 + rand() * 0.85;
        tmp.copy(key.lampPos).addScaledVector(axis, f);
        const spread = Math.tan(0.1) * axis.length() * f;
        tmp.x += (rand() - 0.5) * 2 * spread;
        tmp.y += (rand() - 0.5) * 2 * spread * 0.6;
        tmp.z += (rand() - 0.5) * 2 * spread;
        tmp.y = Math.max(0.2, tmp.y);
      }
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
      seed.set([rand(), rand(), rand(), rand()], i * 4);
    }
    dustGeo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    dustGeo.setAttribute("aSeed", new Float32BufferAttribute(seed, 4));
  }
  const dust = new Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 6;
  scene.add(dust);

  /* ---- Tactical markers (squad scene) ------------------------------------ */
  // A 3-5-2 defending the goal at +x, seen from behind that goal like a
  // tactics board. One marker per position line is interactive; its label
  // sits just below it on screen (towards the camera).
  const formationSpots: [number, number][] = [
    [39, -12.5], [39, 12.5],
    [30, -19], [31, -9], [31, 9], [30, 19],
    [22, -8],
  ];
  const anchors: Record<PositionKey, [number, number]> = {
    goalkeeper: [47, 0],
    defender: [40, 0],
    midfielder: [29.5, 0],
    forward: [18.5, 0],
  };
  const accent = new Color("#b8f23f");
  const formation = new Mesh(
    merge(
      formationSpots.map(([x, z]) => {
        const g = new RingGeometry(0.55, 0.7, 40);
        g.rotateX(-Math.PI / 2);
        g.translate(x, 0.03, z * m);
        return g;
      }),
    ),
    new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
  );
  formation.renderOrder = 3;
  scene.add(formation);
  const markers: MarkerRig[] = o.markers.map((spec) => {
    const [x, z] = anchors[spec.position];
    const center = v(x, 0.04, z * m);
    const ringGeo = new RingGeometry(1.45, 1.72, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    ring.position.copy(center);
    const discGeo = new CircleGeometry(1.45, 48);
    discGeo.rotateX(-Math.PI / 2);
    const disc = new Mesh(discGeo, new MeshBasicMaterial({ map: glow, color: accent, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    disc.position.copy(center);
    const family = o.rtl ? o.fonts.arabic : o.fonts.latin;
    const tex = track(
      labelTexture(
        [
          { text: o.rtl ? spec.title : spec.title.toUpperCase(), font: `800 92px ${family}`, color: "rgba(240,246,238,0.96)" },
          { text: spec.detail, font: `600 64px ${family}`, color: "rgba(184,242,63,0.95)" },
        ],
        o.rtl,
      ),
    );
    // Flat on the grass, reading upright for a camera looking down the pitch towards −x
    // (the mirrored Arabic shot looks the same way, so no flip is needed).
    const labelGeo = new PlaneGeometry(12, 3);
    labelGeo.rotateX(-Math.PI / 2);
    labelGeo.rotateY(Math.PI / 2);
    const label = new Mesh(labelGeo, new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    label.position.set(x + 3.6, 0.05, z * m);
    for (const mesh of [ring, disc, label]) {
      mesh.renderOrder = 3;
      scene.add(mesh);
    }
    return { position: spec.position, center, ring, disc, label };
  });

  return {
    scene,
    towers,
    hemi,
    ball,
    ballMaterial: ballMat,
    shadowUniforms,
    grass,
    grassUniforms,
    dust,
    dustMaterial: dustMat,
    boards,
    boardTextures: { brand, tournament },
    roofLights,
    netUniforms: net.uniforms,
    flagUniforms: flag.uniforms,
    markers,
    formation,
    sky,
    distant,
    dispose() {
      const materials = new Set<Material>();
      scene.traverse((obj) => {
        const mesh = obj as Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as Material | Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => materials.add(x));
        else if (mat) materials.add(mat);
        if (obj instanceof SpotLight) obj.shadow.map?.dispose();
      });
      materials.forEach((x) => x.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}

/* ------------------------------------------------------------------------
   Geometry helpers
   ------------------------------------------------------------------------ */

/** One grass blade, 1 unit tall, tapering to a point and curving slightly forward. */
function bladeGeometry(): BufferGeometry {
  const rows = [
    [0, 0.5],
    [0.38, 0.42],
    [0.72, 0.26],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const [y, w] of rows) {
    const z = 0.22 * y * y;
    pos.push(-w, y, z, w, y, z);
    uv.push(0.5 - w, y, 0.5 + w, y);
  }
  pos.push(0, 1, 0.22);
  uv.push(0.5, 1);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new Float32BufferAttribute(Array.from({ length: 7 }, () => [0, 0.25, 1]).flat(), 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
  return g;
}

/**
 * Terrace profile extruded along its length. Profile space: x from the front
 * wall backwards, y up, z along the stand (0..length).
 */
function standGeometry(rows: number, length: number): BufferGeometry {
  const tread = 0.8;
  const rise = 0.42;
  const front = 1.2;
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(0, front);
  for (let i = 0; i < rows; i++) {
    s.lineTo(tread * (i + 1), front + rise * i);
    s.lineTo(tread * (i + 1), front + rise * (i + 1));
  }
  const depth = tread * rows;
  const topY = front + rise * rows;
  s.lineTo(depth + 1.4, topY);
  s.lineTo(depth + 1.4, topY + 2.6);
  s.lineTo(depth + 1.9, topY + 2.6);
  s.lineTo(depth + 1.9, 0);
  s.lineTo(0, 0);
  return new ExtrudeGeometry(s, { depth: length, bevelEnabled: false, steps: 1 });
}

/** A tapering four-legged lattice mast. */
function latticeMast(base: Vector3, height: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const b = 1.9;
  const t = 0.75;
  const corner = (y: number, cx: number, cz: number) => {
    const half = b + (t - b) * (y / height);
    return v(base.x + cx * half, y, base.z + cz * half);
  };
  const cs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [cx, cz] of cs) parts.push(member(corner(0, cx, cz), corner(height, cx, cz), 0.2));
  const levels = 12;
  for (let l = 0; l < levels; l++) {
    const y0 = (height / levels) * l;
    const y1 = (height / levels) * (l + 1);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = cs[k];
      const [bx, bz] = cs[(k + 1) % 4];
      parts.push(member(corner(y1, ax, az), corner(y1, bx, bz), 0.08));
      parts.push(member(corner(y0, ax, az), corner(y1, bx, bz), 0.06));
    }
  }
  const deck = new BoxGeometry(3.6, 0.18, 3.6);
  deck.translate(base.x, height - 0.2, base.z);
  parts.push(deck);
  return parts;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Small deterministic PRNG so the stadium is identical on every visit. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
