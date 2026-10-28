import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderChunk,
  ShaderMaterial,
  Vector3,
  Vector4,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from "three";

/* ------------------------------------------------------------------------
   Shared GLSL
   ------------------------------------------------------------------------ */
const NOISE = /* glsl */ `
float st_hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float st_hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float st_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(st_hash12(i), st_hash12(i + vec2(1.0, 0.0)), u.x), mix(st_hash12(i + vec2(0.0, 1.0)), st_hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float st_noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(st_hash13(i), st_hash13(i + vec3(1.0, 0.0, 0.0)), u.x), mix(st_hash13(i + vec3(0.0, 1.0, 0.0)), st_hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y);
  float b = mix(mix(st_hash13(i + vec3(0.0, 0.0, 1.0)), st_hash13(i + vec3(1.0, 0.0, 1.0)), u.x), mix(st_hash13(i + vec3(0.0, 1.0, 1.0)), st_hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
float st_fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * st_noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
// Derivative-based bump (the maths of three's perturbNormalArb, without a bump texture).
vec3 st_perturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

const linear = (hex: string) => new Color(hex); // Color.set() converts sRGB → the linear working space

type Uniforms = Record<string, IUniform>;

/* ------------------------------------------------------------------------
   Analytic ball shadows. Every floodlight casts its own soft shadow of the
   ball — the four-pointed shadow that is the signature of football under
   lights. Computed exactly (ray–sphere) inside three's spot-light loop, so
   each shadow carries the strength of its own light and follows the ball
   when it is in the air. The penumbra widens with distance from the ball,
   as it does for a lamp bank a few metres across.
   ------------------------------------------------------------------------ */
export const ballShadowUniforms = (): Uniforms => ({
  uBallView: { value: new Vector3(0, -1000, 0) },
  uBallRadius: { value: 0.11 },
});

const BALL_SHADOW_PARS = /* glsl */ `
uniform vec3 uBallView; uniform float uBallRadius;
float stBallShadow(vec3 P, vec3 L) {
  vec3 d = L - P;
  float dl = length(d);
  d /= dl;
  vec3 c = uBallView - P;
  float t = dot(c, d);
  if (t <= 0.0 || t >= dl) return 1.0;
  float h = length(c - d * t);
  float pen = 0.004 + t * 0.035;
  return smoothstep(uBallRadius - pen, uBallRadius + pen, h);
}
`;

function withBallShadows(fragmentShader: string): string {
  const spotLine = "getSpotLightInfo( spotLight, geometryPosition, directLight );";
  if (!ShaderChunk.lights_fragment_begin.includes(spotLine)) return fragmentShader; // three changed: no ball shadows, still renders
  return fragmentShader
    .replace("#include <common>", `#include <common>\n${BALL_SHADOW_PARS}`)
    .replace(
      "#include <lights_fragment_begin>",
      ShaderChunk.lights_fragment_begin.replace(spotLine, `${spotLine}\n\t\tdirectLight.color *= stBallShadow( geometryPosition, spotLight.position );`),
    );
}

/**
 * Grass is a rough canopy of blades that shadow one another: it has nothing
 * like the grazing-angle sheen of a smooth dielectric, so damp the Fresnel
 * rise and the specular level (otherwise a low camera sees a grey glare).
 */
const CANOPY_SPECULAR = /* glsl */ `
material.specularF90 = 0.3;
material.specularColor *= 0.55;
material.specularColorBlended *= 0.55;
`;

/* ------------------------------------------------------------------------
   Pitch: natural grass with Law 1 markings, mowing stripes and wear.
   ------------------------------------------------------------------------ */
export function pitchMaterial(shadow: Uniforms) {
  const uniforms: Uniforms = {
    ...shadow,
    uGrassDark: { value: linear("#163f1b") },
    uGrassLight: { value: linear("#2a6526") },
    uWorn: { value: linear("#4a4a2c") },
    uPaint: { value: linear("#d9ddd3") },
    uConcrete: { value: linear("#1c1f1d") },
  };
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvStWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = withBallShadows(shader.fragmentShader)
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vStWorld;
uniform vec3 uGrassDark; uniform vec3 uGrassLight; uniform vec3 uWorn; uniform vec3 uPaint; uniform vec3 uConcrete;
${NOISE}
float st_seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// Distance to the nearest painted line (Law 1 dimensions, metres).
float st_markings(vec2 p) {
  vec2 q = abs(p);
  float d = 1e5;
  d = min(d, st_seg(q, vec2(0.0, 34.0), vec2(52.5, 34.0)));      // touchlines
  d = min(d, st_seg(q, vec2(52.5, 0.0), vec2(52.5, 34.0)));      // goal lines
  d = min(d, st_seg(p, vec2(0.0, -34.0), vec2(0.0, 34.0)));      // halfway line
  d = min(d, abs(length(p) - 9.15));                             // centre circle
  d = min(d, st_seg(q, vec2(36.0, 20.16), vec2(52.5, 20.16)));   // penalty areas
  d = min(d, st_seg(q, vec2(36.0, 0.0), vec2(36.0, 20.16)));
  d = min(d, st_seg(q, vec2(47.0, 9.16), vec2(52.5, 9.16)));     // goal areas
  d = min(d, st_seg(q, vec2(47.0, 0.0), vec2(47.0, 9.16)));
  float arc = abs(length(q - vec2(41.5, 0.0)) - 9.15);           // penalty arcs, outside the area only
  d = min(d, q.x < 36.0 ? arc : 1e5);
  float corner = abs(length(q - vec2(52.5, 34.0)) - 1.0);        // corner arcs
  d = min(d, (q.x < 52.5 && q.y < 34.0) ? corner : 1e5);
  return d;
}
float st_spots(vec2 p) { vec2 q = abs(p); return min(length(p) - 0.11, length(q - vec2(41.5, 0.0)) - 0.11); }
float st_height(vec2 p) { return st_noise(p * 9.0) * 0.55 + st_noise(p * 38.0) * 0.45; }`,
      )
      .replace(
        "#include <map_fragment>",
        `
vec2 stP = vStWorld.xz;
vec2 stQ = abs(stP);
float stPx = length(fwidth(stP));             // world size of one pixel
float stAA = stPx * 0.75 + 0.0015;
float stLine = 1.0 - smoothstep(0.06 - stAA, 0.06 + stAA, st_markings(stP));
stLine = max(stLine, 1.0 - smoothstep(-stAA, stAA, st_spots(stP)));
// Mowing stripes: alternate bands lean opposite ways, so a band reads light or
// dark depending on where you stand — and the pattern flips from the other end.
float stStripeSign = mod(floor((stP.x + 52.5) / 5.25), 2.0) * 2.0 - 1.0;
vec2 stToEye = normalize(cameraPosition.xz - stP + 1e-4);
float stStripe = stStripeSign * (0.05 + 0.14 * stToEye.x);
float stN1 = st_fbm(stP * 0.16);
float stN2 = st_fbm(stP * 1.6 + 3.1);
float stN3 = st_noise(stP * 7.0);
vec3 stCol = mix(uGrassDark, uGrassLight, stN1);
stCol *= (0.9 + 0.2 * stN2) * (1.0 + stStripe) * (0.95 + 0.1 * stN3);
// Wear where play concentrates: the goal mouths and, faintly, the centre spot.
vec2 stGm = vec2(stQ.x - 48.5, stQ.y);
float stWear = exp(-dot(stGm, stGm) / 22.0) * 0.75 + exp(-dot(stP, stP) / 6.0) * 0.18;
stCol = mix(stCol, uWorn * (0.8 + 0.4 * stN2), clamp(stWear * (0.45 + stN2), 0.0, 0.85));
float stPaint = stLine * (0.84 + 0.16 * st_noise(stP * 34.0));
stCol = mix(stCol, uPaint, stPaint);
float stTurf = step(stQ.x, 56.5) * step(stQ.y, 38.0);
stCol = mix(uConcrete * (0.8 + 0.35 * stN2), stCol, stTurf);
stPaint *= stTurf;
diffuseColor.rgb = stCol;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = mix(0.86, mix(0.94 - 0.08 * stN3, 0.72, stPaint), stTurf);`,
      )
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${CANOPY_SPECULAR}`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
// Blade-scale relief close to the camera, faded out with distance to avoid shimmer.
float stFade = (1.0 - smoothstep(0.004, 0.05, stPx)) * stTurf * (1.0 - stPaint * 0.7);
float stH = st_height(stP);
normal = st_perturb(-vViewPosition, normal, vec2(dFdx(stH), dFdy(stH)) * 0.9 * stFade, faceDirection);`,
      );
  };
  m.customProgramCacheKey = () => "malaab-pitch";
  return m;
}

/* ------------------------------------------------------------------------
   Grass blades (instanced): lean with the mowing direction, breathe with the
   wind, and part where the ball presses into the sward.
   ------------------------------------------------------------------------ */
export function grassMaterial(shadow: Uniforms) {
  const uniforms: Uniforms = {
    ...shadow,
    uTime: { value: 0 },
    uBall: { value: new Vector3(0, 0.11, 0) },
    uWind: { value: 1 },
  };
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: DoubleSide });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime; uniform vec3 uBall; uniform float uWind;
varying float vStH; varying float vStStripe;
float st_h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        "#include <project_vertex>",
        `
vStH = position.y;
vec3 stOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec3 stWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
float stBladeH = stWp.y - stOrigin.y;
float stSign = mod(floor((stOrigin.x + 52.5) / 5.25), 2.0) * 2.0 - 1.0;
vec2 stToEye = normalize(cameraPosition.xz - stOrigin.xz + 1e-4);
vStStripe = stSign * (0.05 + 0.14 * stToEye.x);
float stRand = st_h(stOrigin.xz * 13.1);
vec2 stLean = vec2(stSign * 0.42, 0.0) + (vec2(st_h(stOrigin.xz), stRand) - 0.5) * 0.7;
float stGust = sin(uTime * 1.1 + stOrigin.x * 0.7 + stOrigin.z * 0.45) * 0.5 + 0.5;
stLean += vec2(0.08, 0.05) * uWind * stGust * sin(uTime * 2.3 + stRand * 6.28);
// The ball presses the blades under it outwards and down.
vec2 stD = stOrigin.xz - uBall.xz;
float stDist = length(stD);
float stPress = (1.0 - smoothstep(0.02, 0.16, stDist)) * (1.0 - smoothstep(0.11, 0.2, uBall.y));
stLean += (stD / max(stDist, 1e-4)) * stPress * 1.6;
float stK = vStH * vStH;
stWp.xz += stLean * stK * stBladeH;
stWp.y -= stPress * 0.55 * stK * stBladeH;
vec4 mvPosition = viewMatrix * vec4(stWp, 1.0);
gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
worldPosition = vec4(stWp, 1.0);
#endif`,
      );
    shader.fragmentShader = withBallShadows(shader.fragmentShader)
      .replace("#include <common>", "#include <common>\nvarying float vStH; varying float vStStripe;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
// Self-shadowing inside the sward: dark at the base, lit at the tips.
diffuseColor.rgb *= mix(0.28, 1.08, smoothstep(0.0, 1.0, vStH)) * (1.0 + vStStripe);`,
      )
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${CANOPY_SPECULAR}`)
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
// Thin blades scatter light more like a canopy than a flat card.
normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.62));`,
      );
  };
  m.customProgramCacheKey = () => "malaab-grass";
  return { material: m, uniforms };
}

/* ------------------------------------------------------------------------
   Football: the classic 32-panel truncated icosahedron, evaluated per pixel
   so it stays crisp in close-up. Seams are recessed grooves, panels slightly
   domed, glossy PU with light wear.
   ------------------------------------------------------------------------ */
function truncatedIcosahedronPanels(): Vector4[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const verts: Vector3[] = [];
  for (const [a, b] of [
    [1, phi],
    [-1, phi],
    [1, -phi],
    [-1, -phi],
  ]) {
    verts.push(new Vector3(0, a, b), new Vector3(a, b, 0), new Vector3(b, 0, a));
  }
  // Pentagons sit over the icosahedron's vertices, hexagons over its faces.
  const pent = verts.map((v) => v.clone().normalize());
  const hex: Vector3[] = [];
  const isEdge = (a: Vector3, b: Vector3) => Math.abs(a.distanceTo(b) - 2) < 1e-6;
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++) {
        if (isEdge(verts[i], verts[j]) && isEdge(verts[j], verts[k]) && isEdge(verts[i], verts[k])) {
          hex.push(verts[i].clone().add(verts[j]).add(verts[k]).normalize());
        }
      }
  // Face distances of a truncated icosahedron (edge 1): pentagons 2.32744, hexagons 2.26728.
  const hPent = 2.32744 / 2.26728;
  return [...pent.map((n) => new Vector4(n.x, n.y, n.z, 1 / hPent)), ...hex.map((n) => new Vector4(n.x, n.y, n.z, 1))];
}

export function ballMaterial() {
  const uniforms: Uniforms = {
    uPanels: { value: truncatedIcosahedronPanels() },
    uHex: { value: linear("#eef0ea") },
    uPent: { value: linear("#15181a") },
    uSeam: { value: linear("#3a3d39") },
  };
  const m = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.26,
  });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStObjN;")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvStObjN = objectNormal;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vStObjN;
uniform vec4 uPanels[32]; uniform vec3 uHex; uniform vec3 uPent; uniform vec3 uSeam;
${NOISE}`,
      )
      .replace(
        "#include <map_fragment>",
        `
vec3 stD = normalize(vStObjN);
// Radial projection onto the polyhedron: the face hit first has the largest
// dot(d, n) / h; the gap to the runner-up measures the distance to a seam.
float stBest = -1.0; float stSecond = -1.0; int stIdx = 0;
for (int i = 0; i < 32; i++) {
  float v = dot(stD, uPanels[i].xyz) * uPanels[i].w;
  if (v > stBest) { stSecond = stBest; stBest = v; stIdx = i; } else if (v > stSecond) { stSecond = v; }
}
float stEdge = (stBest - stSecond) / stBest;
float stAA = fwidth(stEdge) * 1.2 + 1e-4;
float stGroove = 1.0 - smoothstep(0.006, 0.006 + stAA, stEdge);
float stShoulder = 1.0 - smoothstep(0.0, 0.03 + stAA, stEdge);
float stWear = smoothstep(0.55, 0.85, st_noise3(stD * 9.0)) * 0.6 + st_noise3(stD * 40.0) * 0.4;
vec3 stPanel = stIdx < 12 ? uPent : uHex;
diffuseColor.rgb = stPanel * (1.0 - 0.06 * stWear);
diffuseColor.rgb = mix(diffuseColor.rgb, uSeam, stGroove * 0.9);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = clamp(roughness + 0.14 * stWear + 0.4 * stGroove + (stIdx < 12 ? 0.04 : 0.0), 0.0, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
// Panels are slightly domed between stitched, recessed seams.
float stHt = -stShoulder * stShoulder;
normal = st_perturb(-vViewPosition, normal, vec2(dFdx(stHt), dFdy(stHt)) * 1.4, faceDirection);`,
      );
  };
  m.customProgramCacheKey = () => "malaab-ball";
  return m;
}

/* ------------------------------------------------------------------------
   Goal net: knotted cord mesh computed per pixel (no texture), blending into
   a faint veil at a distance as a real net does. A damped ripple travels out
   from where the ball strikes it.
   ------------------------------------------------------------------------ */
export function netMaterial() {
  const uniforms: Uniforms = {
    uImpact: { value: new Vector4(0, -100, 0, 0) },
    uImpactAge: { value: 10 },
  };
  const m = new MeshStandardMaterial({
    color: 0xf2f4ee,
    roughness: 0.85,
    metalness: 0,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec4 uImpact; uniform float uImpactAge;
varying vec3 vStWorld; varying vec3 vStN;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vec3 stW0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
float stDd = distance(stW0, uImpact.xyz);
float stWave = uImpact.w * exp(-stDd * stDd / 0.5) * exp(-uImpactAge * 2.6) * sin(uImpactAge * 17.0 - stDd * 5.0);
// Gravity: the panel hangs slightly between its edges.
float stSag = sin(3.14159 * uv.x) * sin(3.14159 * uv.y) * 0.05;
transformed += normal * (stWave * 0.32 + stSag);
vStWorld = stW0;
vStN = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStWorld; varying vec3 vStN;")
      .replace(
        "#include <alphamap_fragment>",
        `#include <alphamap_fragment>
vec3 stAn = abs(vStN);
vec2 stC = (stAn.x > 0.5 ? vStWorld.zy : (stAn.z > 0.5 ? vStWorld.xy : vStWorld.xz)) / 0.12;
vec2 stF = abs(fract(stC + 0.5) - 0.5) * 0.12;      // distance to the nearest cord, metres
vec2 stFw = fwidth(stC) * 0.12;
float stCord = max(1.0 - smoothstep(0.0028 - stFw.x, 0.0028 + stFw.x, stF.x), 1.0 - smoothstep(0.0028 - stFw.y, 0.0028 + stFw.y, stF.y));
float stFar = smoothstep(0.2, 0.9, max(fwidth(stC).x, fwidth(stC).y));
diffuseColor.a *= mix(stCord, 0.09, stFar);`,
      );
  };
  m.customProgramCacheKey = () => "malaab-net";
  return { material: m, uniforms };
}

/* ------------------------------------------------------------------------
   Corner flag: cloth waving from its pole.
   ------------------------------------------------------------------------ */
export function flagMaterial() {
  const uniforms: Uniforms = { uTime: { value: 0 } };
  const m = new MeshStandardMaterial({ color: linear("#b8f23f"), roughness: 0.75, side: DoubleSide, emissive: linear("#2a3a10") });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
float stU = uv.x;
transformed.z += sin(uTime * 4.2 - stU * 6.0) * stU * 0.06 + sin(uTime * 7.1 - stU * 11.0) * stU * 0.015;
transformed.y -= stU * stU * 0.03;`,
    );
  };
  m.customProgramCacheKey = () => "malaab-flag";
  return { material: m, uniforms };
}

/* ------------------------------------------------------------------------
   Stands: concrete terraces with rows of plastic seats on the treads.
   ------------------------------------------------------------------------ */
export function standMaterial() {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStObj; varying vec3 vStObjN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStObj = position; vStObjN = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vStObj; varying vec3 vStObjN;\n${NOISE}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
// Profile space: x from the front row backwards (0.8 m treads), y up, z along the stand.
vec3 stConcrete = vec3(0.034, 0.036, 0.035) * (0.85 + 0.3 * st_noise(vStObj.zx * 3.0 + vStObj.y));
float stTread = step(0.7, vStObjN.y);
float stRow = fract(vStObj.x / 0.8);
float stSeatX = fract(vStObj.z / 0.5);
float stSeat = stTread * step(0.3, stRow) * step(stRow, 0.86) * step(0.08, stSeatX) * step(stSeatX, 0.92);
float stShade = st_hash12(floor(vec2(vStObj.z / 0.5, vStObj.x / 0.8)));
vec3 stSeatCol = mix(vec3(0.012, 0.03, 0.02), vec3(0.02, 0.05, 0.032), stShade);
diffuseColor.rgb = mix(stConcrete, stSeatCol, stSeat);`,
      );
  };
  m.customProgramCacheKey = () => "malaab-stand";
  return m;
}

/* ------------------------------------------------------------------------
   Floodlight beam: light scattered by the night haze inside the cone,
   brighter along the axis and near the lamps, soft at the silhouette, and
   slightly uneven as haze is.
   ------------------------------------------------------------------------ */
export function beamMaterial() {
  return new ShaderMaterial({
    uniforms: { uIntensity: { value: 0 }, uColor: { value: linear("#eef6e2") }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  vAlong = 0.5 - position.y; // 0 at the lamp (apex), 1 at the far end; the cone is built with height 1
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform float uIntensity; uniform vec3 uColor; uniform float uTime;
varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vW;
${NOISE}
void main() {
  float facing = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
  float along = clamp(vAlong, 0.0, 1.0);
  float falloff = pow(1.0 - along, 1.4) * smoothstep(0.0, 0.03, along);
  float haze = 0.7 + 0.3 * st_noise3(vW * 0.06 + vec3(uTime * 0.04, 0.0, uTime * 0.02));
  float a = clamp(uIntensity * facing * falloff * haze * 0.13, 0.0, 1.0);
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/* ------------------------------------------------------------------------
   Dust in the light: motes drifting in still air, visible where the key
   beam reaches them and brightest looking into the light (forward
   scattering, Henyey–Greenstein phase).
   ------------------------------------------------------------------------ */
export function dustMaterial(pixelRatio: number) {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uLightPos: { value: new Vector3() },
      uLightDir: { value: new Vector3(0, -1, 0) },
      uCone: { value: Math.cos(0.26) },
    },
    vertexShader: /* glsl */ `
uniform float uTime; uniform float uPixelRatio; uniform vec3 uLightPos; uniform vec3 uLightDir; uniform float uCone; uniform float uIntensity;
attribute vec4 aSeed;
varying float vLit;
void main() {
  vec3 p = position;
  float t = uTime * (0.08 + aSeed.w * 0.06);
  p += vec3(sin(t + aSeed.x * 6.28), sin(t * 0.7 + aSeed.y * 6.28) * 0.6 + 0.25 * sin(t * 0.31), cos(t * 0.9 + aSeed.z * 6.28)) * (0.35 + aSeed.w * 0.5);
  vec3 world = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 fromLight = normalize(world - uLightPos);
  float inBeam = smoothstep(uCone, uCone + 0.02, dot(fromLight, uLightDir));
  vec3 toEye = normalize(cameraPosition - world);
  float g = 0.55;
  float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * dot(fromLight, toEye), 1.5);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  float dist = -mv.z;
  float near = smoothstep(0.25, 1.4, dist); // out-of-focus motes right at the lens are fainter
  vLit = uIntensity * inBeam * (0.12 + 0.3 * phase) * mix(0.25, 1.0, near) * (0.4 + aSeed.w * 0.6) * (1.0 - smoothstep(18.0, 45.0, dist));
  gl_PointSize = clamp((1.1 + aSeed.w * 1.7) * uPixelRatio * (6.0 / max(dist, 0.3)), 1.0, 14.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
varying float vLit;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = clamp(smoothstep(0.5, 0.0, d) * vLit * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(1.0, 0.98, 0.93, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/* ------------------------------------------------------------------------
   Night sky over the city: near black at the zenith, warm haze of street
   light towards the horizon.
   ------------------------------------------------------------------------ */
export function skyMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uZenith: { value: linear("#020403") },
      uHorizon: { value: linear("#1a1810") },
      uGround: { value: linear("#030403") },
      uGlowColor: { value: linear("#3a4436") },
      uGlow: { value: 0 },
    },
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uGlowColor; uniform float uGlow;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 col = h > 0.0 ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.38)) : mix(uHorizon, uGround, clamp(-h * 6.0, 0.0, 1.0));
  // Floodlight scattered back from the haze above the stadium.
  col += uGlowColor * uGlow * pow(1.0 - clamp(abs(h), 0.0, 1.0), 2.5) * 0.35;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    side: BackSide,
    depthWrite: false,
  });
}

/* ------------------------------------------------------------------------
   Point lights at a distance: stars above, the city on the horizon.
   ------------------------------------------------------------------------ */
export function distantLightsMaterial(pixelRatio: number) {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uLevel: { value: 1 } },
    vertexShader: /* glsl */ `
uniform float uTime; uniform float uPixelRatio;
attribute vec3 aColor; attribute vec2 aSeed;
varying vec3 vColor;
void main() {
  float tw = 0.75 + 0.25 * sin(uTime * (0.6 + aSeed.y * 2.0) + aSeed.x * 40.0);
  vColor = aColor * tw;
  gl_PointSize = (0.9 + aSeed.y * 1.6) * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uLevel;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * uLevel;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
