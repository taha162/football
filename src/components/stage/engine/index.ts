import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type MeshPhysicalMaterial,
  type WebGLRenderTarget,
} from "three";
import { clamp01, damp, damp3, ease, scrollPose, smoothstep, type Pose } from "@/lib/stage/camera";
import { applyImpulse, BALL, createBall, kickFromFlick, placeBall, step, type BallState, type Contact, type Vec3 } from "@/lib/stage/physics";
import { FrameGovernor, initialTier, LOWER, TIERS, type Tier } from "@/lib/stage/quality";
import { INTRO_SEEN_KEY } from "../intro-script";
import { StageAudio } from "./audio";
import { INTRO, introCamera, SCENES, sceneShots } from "./poses";
import { buildWorld, LAMP_COLOR, TOWER_CANDELA, type MarkerSpec, type PositionKey, type World } from "./world";

export type { MarkerSpec, PositionKey } from "./world";
export type { Tier } from "@/lib/stage/quality";

export interface StageEvents {
  /** "play" when the opening starts, "headline" when the copy should arrive, "done" at the end (or when skipped). */
  onIntro?: (phase: "play" | "headline" | "done") => void;
  /** The ball has left (or come back to) the centre spot. */
  onBallAway?: (away: boolean) => void;
  onKick?: () => void;
  onMarkerHover?: (position: PositionKey | null) => void;
  onFirstFrame?: () => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onTier?: (tier: Tier) => void;
  /** A shader failed to compile on this GPU: the host should fall back to the still image. */
  onError?: () => void;
}

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** The HTML control that sits over the ball (positioned every frame). */
  handle: HTMLElement | null;
  rtl: boolean;
  reducedMotion: boolean;
  /** GPU renderer string from the capability probe, if the browser exposed one. */
  gpu?: string;
  fonts: { arabic: string; latin: string };
  markers: MarkerSpec[];
  events?: StageEvents;
}

const LAST = SCENES.length - 1;
const HANDOVER = 0.55;
const SQUAD = SCENES.indexOf("squad");
const TOURNAMENTS = SCENES.indexOf("tournaments");
const FINAL = SCENES.indexOf("final");
/** The tower facing the camera in the closing shot; it stays on while the others dim. */
const FINAL_TOWER = 3;

/** How present a scene is at scroll coordinate s: rises as the camera arrives, falls as it leaves. */
function presence(s: number, i: number) {
  const up = i === 0 ? 1 : smoothstep(i - 1 + HANDOVER, i, s);
  const down = i === LAST ? 1 : 1 - smoothstep(i + HANDOVER, i + 1, s);
  return Math.min(up, down);
}

/** A lamp bank switching on: contactor, an arc flicker, then it settles to full output. */
function ignition(t: number) {
  if (t < 0) return 0;
  if (t < 0.05) return 0.75;
  if (t < 0.12) return 0.08;
  if (t < 0.16) return 0.95;
  if (t < 0.24) return 0.3;
  return 0.8 + 0.2 * ease.out(clamp01((t - 0.24) / 0.6));
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const tmp3 = new Vector3();
const UP = new Vector3(0, 1, 0);

export class Stage {
  private readonly renderer: WebGLRenderer;
  private readonly camera: PerspectiveCamera;
  private readonly world: World;
  private readonly governor: FrameGovernor;
  private readonly audio = new StageAudio();
  private readonly m: 1 | -1;
  private tier: Tier;
  private envTarget: WebGLRenderTarget | null = null;
  private shots: ((f: number) => Pose)[];
  private size = { w: 1, h: 1 };

  private raf = 0;
  private last = 0;
  private lastRender = 0;
  private active = true;
  private started = false;
  private lost = false;
  private motion = true;
  private struggling = false;
  private dirty = true;
  private firstFrame = false;
  private grassEnabled: boolean;

  /** Ambient clock: advances only while ambient motion is allowed. */
  private time = 0;
  private introT = -1;
  /** Frame-time sample from the opening, to drop it on devices that cannot play it smoothly. */
  private introFrames = { n: 0, sum: 0 };
  private intro: ((t: number) => Pose) | null = null;
  private fired = new Set<string>();

  private sTarget = 0.5;
  private s = 0.5;
  private cur: Pose | null = null;
  private pointer: [number, number] = [0, 0];
  private parallax: [number, number] = [0, 0];

  private readonly ball: BallState = createBall();
  private follow: Vec3 = [0, 0, 0];
  private restAway = 0;
  private ballAway = false;
  private levels = [0, 0, 0, 0];
  private boardLevel = 0;
  private beamBoost = 0;
  private markerLevel = 0;
  private hover: PositionKey | null = null;
  private highlight: PositionKey | null = null;
  private netAge = 10;
  private handleState = "";

  constructor(private readonly o: StageOptions) {
    this.m = o.rtl ? -1 : 1;
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.tier = initialTier({
      renderer: o.gpu,
      memory: nav.deviceMemory,
      cores: nav.hardwareConcurrency,
      coarse: window.matchMedia("(pointer: coarse)").matches,
      pixels: window.innerWidth * window.innerHeight * window.devicePixelRatio ** 2,
    });
    const settings = TIERS[this.tier];
    this.renderer = new WebGLRenderer({
      canvas: o.canvas,
      antialias: settings.antialias,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = settings.shadowMap > 0;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // nothing that casts a mapped shadow moves
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
    // three.js logs a failed shader and carries on drawing nothing; hand over to the still image instead.
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      console.error("Stage shader failed to compile.", gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
      this.lost = true;
      this.stop();
      window.setTimeout(() => this.o.events?.onError?.(), 0);
    };
    this.camera = new PerspectiveCamera(42, 1, 0.08, 1200);
    this.world = buildWorld({
      tier: settings,
      rtl: o.rtl,
      fonts: o.fonts,
      markers: o.markers,
      pixelRatio: this.renderer.getPixelRatio(),
    });
    this.grassEnabled = this.world.grass !== null;
    this.buildEnvironment();
    this.governor = new FrameGovernor(() => this.slower());
    this.shots = sceneShots(this.m, 16 / 9);
    this.resize();
    o.canvas.addEventListener("webglcontextlost", this.onLost);
    o.canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  get currentTier() {
    return this.tier;
  }

  get introPlaying() {
    return this.introT >= 0;
  }

  /** Compiles every shader without blocking the page, so the first frame does not stall. */
  async prepare() {
    this.applyCamera(this.shots[0](0.5));
    await this.renderer.compileAsync(this.world.scene, this.camera);
  }

  /** Starts rendering, with or without the opening sequence. */
  begin(withIntro: boolean) {
    if (withIntro && !this.o.reducedMotion) {
      this.intro = introCamera(this.m, this.shots[0](0.5));
      this.introT = 0;
      this.o.events?.onIntro?.("play");
    } else {
      this.finishIntro(true);
    }
    this.started = true;
    this.start();
  }

  skipIntro() {
    if (this.introT >= 0) this.finishIntro(false);
  }

  /** Scroll position as a scene coordinate: scene index + progress through it. */
  setScroll(s: number) {
    this.sTarget = Math.min(Math.max(s, 0), LAST + 0.999);
  }

  /** Pointer position in −1..1 (fine pointers only) for a little parallax. */
  setPointer(nx: number, ny: number) {
    this.pointer = [Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny))];
  }

  /** Pause rendering entirely (tab hidden, stage scrolled away). */
  setActive(on: boolean) {
    this.active = on;
    this.audio.setActive(on);
    if (on) this.start();
    else this.stop();
  }

  /** Ambient motion (dust, wind, LED scroll, breathing camera) on or off. */
  setMotion(on: boolean) {
    this.motion = on;
    this.dirty = true;
  }

  async setSound(on: boolean) {
    if (on) await this.audio.enable();
    else this.audio.disable();
  }

  /** Kick from a flick: release velocity in CSS px/s (screen up = away from the camera). */
  kickFromScreen(vx: number, vy: number) {
    const speedPx = Math.hypot(vx, vy);
    if (speedPx < 60) {
      this.kickForward(4);
      return;
    }
    const { fwd, right } = this.groundBasis();
    const dx = right.x * vx - fwd.x * vy;
    const dz = right.z * vx - fwd.z * vy;
    const len = Math.hypot(dx, dz) || 1;
    const speed = Math.min(22, Math.max(1.5, (speedPx / this.size.h) * 5.5));
    this.kick((dx / len) * speed, (dz / len) * speed);
  }

  /** Keyboard kick: straight down the camera's line. */
  kickForward(speed = 9) {
    const { fwd } = this.groundBasis();
    this.kick(fwd.x * speed, fwd.z * speed);
  }

  /** Rolls the ball back to the centre spot with exactly the pace to stop on it. */
  resetBall() {
    const b = this.ball;
    const dist = Math.hypot(b.p[0], b.p[2]);
    if (dist < 0.3) return;
    const ux = -b.p[0] / dist;
    const uz = -b.p[2] / dist;
    const R = BALL.radius;
    const trial = (speed: number) => {
      const sim: BallState = { p: [b.p[0], R, b.p[2]], v: [ux * speed, 0, uz * speed], w: [(uz * speed) / R, 0, (-ux * speed) / R], q: [0, 0, 0, 1], asleep: false, grounded: true };
      for (let i = 0; i < 900 && !sim.asleep; i++) step(sim, 1 / 30, undefined, undefined, 1 / 120);
      return sim.p;
    };
    let lo = 0;
    let hi = 22;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      const end = trial(mid);
      if ((end[0] - b.p[0]) * ux + (end[2] - b.p[2]) * uz < dist) lo = mid;
      else hi = mid;
    }
    const speed = (lo + hi) / 2;
    const end = trial(speed);
    if (b.p[1] < R + 0.05 && Math.hypot(end[0], end[2]) < 0.8) {
      b.v = [ux * speed, 0, uz * speed];
      b.w = [(uz * speed) / R, 0, (-ux * speed) / R];
      b.asleep = false;
    } else {
      // Blocked (e.g. resting in a net): put it back on the spot.
      placeBall(b, 0, 0);
    }
    this.restAway = 0;
    this.dirty = true;
  }

  /** Highlight a tactical marker from the HTML list (hover/focus). */
  highlightMarker(p: PositionKey | null) {
    this.highlight = p;
    this.dirty = true;
  }

  /** Which tactical marker (if any) is under a point in canvas CSS pixels. */
  markerAt(x: number, y: number): PositionKey | null {
    if (presence(this.s, SQUAD) < 0.6) return null;
    for (const mk of this.world.markers) {
      const c = this.toScreen(mk.center);
      const edge = this.toScreen(tmp2.copy(mk.center).addScaledVector(this.cameraRight(), 1.9));
      const label = this.toScreen(mk.label.position);
      if (!c || !edge) continue;
      const r = Math.hypot(edge[0] - c[0], edge[1] - c[1]);
      if (Math.hypot(x - c[0], y - c[1]) <= r * 1.15) return mk.position;
      if (label && Math.abs(x - label[0]) <= r * 3.2 && Math.abs(y - label[1]) <= r * 0.85) return mk.position;
    }
    return null;
  }

  setHover(p: PositionKey | null) {
    if (p === this.hover) return;
    this.hover = p;
    this.dirty = true;
    this.o.events?.onMarkerHover?.(p);
  }

  resize() {
    const w = this.o.canvas.clientWidth || window.innerWidth;
    const h = this.o.canvas.clientHeight || window.innerHeight;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.shots = sceneShots(this.m, w / h);
    if (this.introT >= 0) this.intro = introCamera(this.m, this.shots[0](0.5));
    this.dirty = true;
  }

  dispose() {
    this.stop();
    this.o.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.o.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.audio.dispose();
    this.world.dispose();
    this.envTarget?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /* -------------------------------------------------------------------- */

  private start() {
    if (this.raf || !this.active || !this.started || this.lost) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dtRaw = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    // Physics and damping take at most 0.1 s per frame; the opening keeps to real time.
    const busy = this.update(Math.min(dtRaw, 0.1), Math.min(dtRaw, 0.5));
    const ambient = this.motion && !this.o.reducedMotion && !this.struggling;
    if (!busy && !this.dirty) {
      // Nothing moving: ambient motion at ~30 fps, or no frames at all.
      if (!ambient || now - this.lastRender < 32) return;
    } else if (now - this.lastRender < 14) {
      return; // ~60 fps cap on high-refresh screens
    }
    this.render();
    this.lastRender = now;
    this.dirty = false;
    if (busy && dtRaw < 0.25) this.governor.sample(dtRaw * 1000);
  };

  private render() {
    if (this.lost) return;
    this.renderer.render(this.world.scene, this.camera);
    if (!this.firstFrame) {
      this.firstFrame = true;
      this.o.events?.onFirstFrame?.();
    }
  }

  /** Advances everything by dt; returns true while something is moving. */
  private update(dt: number, dtReal = dt): boolean {
    const reduced = this.o.reducedMotion;
    const ambient = this.motion && !reduced && !this.struggling;
    if (ambient) this.time += dt;
    let busy = false;

    // Scroll → scene coordinate (cuts between scenes when motion is reduced).
    if (reduced) {
      this.s = Math.floor(this.sTarget);
    } else {
      const prev = this.s;
      this.s = damp(this.s, this.sTarget, 6, dt); // the wheel is already eased (Lenis): follow it closely
      if (Math.abs(this.s - this.sTarget) < 1e-4) this.s = this.sTarget;
      busy ||= Math.abs(this.s - prev) > 1e-6;
    }

    // Opening sequence or scroll-driven shot.
    let pose: Pose | null = null;
    if (this.introT >= 0 && this.intro) {
      this.introT += dtReal;
      busy = true;
      // A choppy opening is worse than none: below ~11 fps (ignoring the first frames,
      // which pay for shader warm-up), go straight to the hero shot.
      if (this.introFrames.n++ >= 2) this.introFrames.sum += dtReal;
      const choppy = this.introT > 1.2 && this.introFrames.n > 6 && this.introFrames.sum / (this.introFrames.n - 2) > 0.09;
      if (!choppy && this.introT >= INTRO.headline && !this.fired.has("headline")) {
        this.fired.add("headline");
        this.o.events?.onIntro?.("headline");
      }
      if (choppy || this.introT >= INTRO.end) this.finishIntro(false);
      else pose = this.intro(this.introT);
    }
    pose ??= scrollPose(this.shots, this.s, HANDOVER);

    // Ball.
    if (!this.ball.asleep) {
      step(this.ball, dt, this.onContact);
      busy = true;
    }
    const focus = Math.min(1, presence(this.s, 0) + presence(this.s, FINAL));
    this.trackBallAway(dt, focus);

    // The camera keeps a rolling ball in frame in the shots that are about it.
    const offX = this.ball.p[0];
    const offZ = this.ball.p[2];
    const offLen = Math.hypot(offX, offZ);
    const k = offLen > 24 ? 24 / offLen : 1;
    const followTarget: Vec3 = [offX * k * focus, 0, offZ * k * focus];
    if (reduced) this.follow = followTarget;
    else damp3(this.follow, followTarget, 3, dt);
    busy ||= Math.abs(this.follow[0] - followTarget[0]) + Math.abs(this.follow[2] - followTarget[2]) > 1e-3;

    const want: Pose = {
      p: [pose.p[0] + this.follow[0] * 0.25, pose.p[1], pose.p[2] + this.follow[2] * 0.25],
      t: [pose.t[0] + this.follow[0] * 0.8, pose.t[1], pose.t[2] + this.follow[2] * 0.8],
      fov: pose.fov,
      roll: pose.roll,
      shift: pose.shift,
    };

    // Parallax (orbit a little around the subject) and a breathing, hand-held camera.
    if (!reduced) {
      const px = this.parallax[0];
      const py = this.parallax[1];
      this.parallax[0] = damp(px, this.pointer[0], 2.5, dt);
      this.parallax[1] = damp(py, this.pointer[1], 2.5, dt);
      busy ||= Math.abs(this.parallax[0] - px) + Math.abs(this.parallax[1] - py) > 1e-4;
      tmp.set(want.t[0] - want.p[0], want.t[1] - want.p[1], want.t[2] - want.p[2]);
      const d = tmp.length();
      const fwd = tmp.normalize();
      const right = tmp2.crossVectors(fwd, UP).normalize();
      const up = tmp3.crossVectors(right, fwd);
      const t = this.time;
      const breath = ambient && this.introT < 0 ? Math.min(6, Math.max(0.5, d / 3)) : 0;
      const hx = (Math.sin(t * 0.71) + 0.6 * Math.sin(t * 1.37 + 1.3)) * 0.004 * breath;
      const hy = (Math.sin(t * 0.53 + 0.4) + 0.5 * Math.sin(t * 1.91 + 2.1)) * 0.003 * breath;
      const ox = this.parallax[0] * d * 0.02 + hx;
      const oy = -this.parallax[1] * d * 0.014 + hy;
      want.p = [want.p[0] + right.x * ox + up.x * oy, want.p[1] + right.y * ox + up.y * oy, want.p[2] + right.z * ox + up.z * oy];
    }

    // Final smoothing of the composed shot (instant during the intro and with reduced motion).
    if (!this.cur || this.introT >= 0 || reduced) {
      this.cur = want;
    } else {
      const c = this.cur;
      const before = c.p[0] + c.p[1] + c.p[2] + c.t[0] + c.t[1] + c.t[2] + c.fov;
      damp3(c.p, want.p, 6, dt);
      damp3(c.t, want.t, 6, dt);
      c.fov = damp(c.fov, want.fov, 6, dt);
      c.roll = damp(c.roll, want.roll, 6, dt);
      c.shift = [damp(c.shift[0], want.shift[0], 6, dt), damp(c.shift[1], want.shift[1], 6, dt)];
      busy ||= Math.abs(c.p[0] + c.p[1] + c.p[2] + c.t[0] + c.t[1] + c.t[2] + c.fov - before) > 1e-4;
    }
    this.applyCamera(this.cur);

    busy = this.updateLights(dt, reduced) || busy;
    busy = this.updateMarkers(dt, reduced) || busy;

    // Surface details.
    const w = this.world;
    if (w.grass && w.grassUniforms) {
      w.grass.visible = this.grassEnabled && this.camera.position.length() < 24;
      w.grassUniforms.uTime.value = this.time;
      (w.grassUniforms.uBall.value as Vector3).set(this.ball.p[0], this.ball.p[1], this.ball.p[2]);
    }
    w.flagUniforms.uTime.value = this.time;
    w.dustMaterial.uniforms.uTime.value = this.time;
    w.distant.uniforms.uTime.value = this.time;
    for (const t of w.towers) t.beamMaterial.uniforms.uTime.value = this.time;
    const scroll = (this.time * 0.018) % 1;
    w.boardTextures.brand.offset.x = scroll;
    w.boardTextures.tournament.offset.x = scroll;
    if (this.netAge < 6) {
      this.netAge += dt;
      w.netUniforms.uImpactAge.value = this.netAge;
      busy = true;
    }

    // Ball mesh and the shadow it casts.
    w.ball.position.set(this.ball.p[0], this.ball.p[1], this.ball.p[2]);
    w.ball.quaternion.set(this.ball.q[0], this.ball.q[1], this.ball.q[2], this.ball.q[3]);
    (w.shadowUniforms.uBallView.value as Vector3).copy(w.ball.position).applyMatrix4(this.camera.matrixWorldInverse);

    this.updateHandle(focus);
    return busy;
  }

  private updateLights(dt: number, reduced: boolean): boolean {
    const w = this.world;
    let busy = false;
    const intro = this.introT >= 0;
    const flare = presence(this.s, TOURNAMENTS);
    const dim = presence(this.s, FINAL);
    for (let i = 0; i < 4; i++) {
      let target: number;
      if (intro) {
        const local = this.introT - INTRO.ignite[i];
        if (local >= 0 && !this.fired.has(`ignite${i}`)) {
          this.fired.add(`ignite${i}`);
          this.audio.clunk();
        }
        target = ignition(local);
        this.levels[i] = target;
      } else {
        // Tournament night: every bank a step brighter, in a quick wave; the
        // final whistle: all but the light facing the camera wind down.
        const wave = smoothstep(i * 0.08, 0.6 + i * 0.08, flare);
        target = (1 + 0.22 * wave) * (i === FINAL_TOWER ? 1 : 1 - 0.66 * dim);
        const prev = this.levels[i];
        this.levels[i] = reduced ? target : damp(prev, target, 3.2, dt);
        busy ||= Math.abs(this.levels[i] - prev) > 1e-4;
      }
    }
    const prevBoost = this.beamBoost;
    this.beamBoost = intro ? 1 : reduced ? 0 : damp(prevBoost, 0, 0.8, dt);
    busy ||= Math.abs(this.beamBoost - prevBoost) > 1e-3;
    const boardTarget = intro ? clamp01((this.introT - INTRO.boards) / 0.45) : 1;
    const prevBoard = this.boardLevel;
    this.boardLevel = intro || reduced ? boardTarget : damp(prevBoard, boardTarget, 4, dt);
    busy ||= Math.abs(this.boardLevel - prevBoard) > 1e-4;

    const cam = this.camera.position;
    let sum = 0;
    w.towers.forEach((t, i) => {
      const L = this.levels[i];
      sum += L;
      t.light.intensity = TOWER_CANDELA * L;
      t.lamps.material.color.copy(LAMP_COLOR).multiplyScalar(14 * L);
      const facing = Math.max(0, tmp.subVectors(cam, t.lampPos).normalize().dot(t.normal));
      t.halo.material.opacity = 0.55 * L * facing ** 1.5;
      t.core.material.opacity = Math.min(1, 0.95 * L * facing);
      if (t.streak) t.streak.material.opacity = 0.32 * L * facing ** 3;
      // The beams read strongest in the opening, when the camera sees them from the side.
      t.beamMaterial.uniforms.uIntensity.value = L * (1 + 0.9 * this.beamBoost);
    });
    const avg = sum / 4;
    w.sky.uniforms.uGlow.value = avg;
    w.hemi.intensity = 0.12 + 0.2 * avg;
    w.dustMaterial.uniforms.uIntensity.value = this.levels[0];
    (w.ballMaterial as MeshPhysicalMaterial).envMapIntensity = 0.75 * Math.min(1, avg);
    w.boards.color.setScalar(1.7 * this.boardLevel);
    w.roofLights.color.setRGB(1, 0.9, 0.74).multiplyScalar(3 * this.boardLevel);
    const tournament = presence(this.s, TOURNAMENTS) > 0.5 ? w.boardTextures.tournament : w.boardTextures.brand;
    if (w.boards.map !== tournament) w.boards.map = tournament;
    this.audio.setLights(avg);
    return busy;
  }

  private updateMarkers(dt: number, reduced: boolean): boolean {
    const w = this.world;
    const target = presence(this.s, SQUAD);
    const prev = this.markerLevel;
    this.markerLevel = reduced ? target : damp(prev, target, 6, dt);
    const L = this.markerLevel;
    const on = L > 0.002;
    w.formation.visible = on;
    w.formation.material.opacity = 0.4 * L;
    w.markers.forEach((mk, i) => {
      mk.ring.visible = mk.disc.visible = mk.label.visible = on;
      if (!on) return;
      const hot = this.hover === mk.position || this.highlight === mk.position;
      const pulse = 1 + 0.05 * Math.sin(this.time * 2 + i * 1.3);
      const scale = pulse * (hot ? 1.14 : 1);
      mk.ring.scale.setScalar(scale);
      mk.disc.scale.setScalar(scale);
      mk.ring.material.opacity = L * (hot ? 1 : 0.78);
      mk.disc.material.opacity = L * (hot ? 0.55 : 0.2);
      mk.label.material.opacity = L * (hot ? 1 : 0.88);
    });
    return Math.abs(L - prev) > 1e-4;
  }

  private applyCamera(pose: Pose) {
    const c = this.camera;
    c.position.set(pose.p[0], pose.p[1], pose.p[2]);
    c.up.set(0, 1, 0);
    c.lookAt(pose.t[0], pose.t[1], pose.t[2]);
    if (pose.roll) c.rotateZ(pose.roll);
    c.fov = pose.fov;
    const { w, h } = this.size;
    c.setViewOffset(w, h, (-pose.shift[0] * w) / 2, (pose.shift[1] * h) / 2, w, h);
    c.updateMatrixWorld();
  }

  private finishIntro(instant: boolean) {
    const wasPlaying = this.introT >= 0;
    this.introT = -1;
    this.intro = null;
    if (instant) {
      this.levels = [1, 1, 1, 1];
      this.boardLevel = 1;
    }
    if (wasPlaying || instant) this.o.events?.onIntro?.("done");
    try {
      window.sessionStorage.setItem(INTRO_SEEN_KEY, "1");
    } catch {
      /* storage may be unavailable (private mode); the intro simply plays again */
    }
    this.dirty = true;
  }

  private kick(vx: number, vz: number) {
    const { impulse, offset } = kickFromFlick([vx, vz]);
    if (impulse[0] === 0 && impulse[2] === 0) return;
    applyImpulse(this.ball, impulse, offset);
    this.audio.kick(Math.hypot(vx, vz));
    this.restAway = 0;
    this.o.events?.onKick?.();
    this.dirty = true;
  }

  private onContact = (c: Contact) => {
    this.audio.contact(c.kind, c.speed);
    if (c.kind === "net") {
      this.netAge = 0;
      this.world.netUniforms.uImpact.value.set(this.ball.p[0], this.ball.p[1], this.ball.p[2], Math.min(1, c.speed / 8));
    }
  };

  private trackBallAway(dt: number, focus: number) {
    const b = this.ball;
    const away = Math.hypot(b.p[0], b.p[2]) > 1.2;
    if (away !== this.ballAway) {
      this.ballAway = away;
      this.o.events?.onBallAway?.(away);
    }
    // A ball left lying away from the spot is rolled back after a while.
    if (away && b.asleep && focus > 0.5 && this.introT < 0) {
      this.restAway += dt;
      if (this.restAway > 6) this.resetBall();
    } else {
      this.restAway = 0;
    }
  }

  private groundBasis() {
    const fwd = this.camera.getWorldDirection(new Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0);
    fwd.normalize();
    const right = new Vector3().crossVectors(fwd, UP).normalize();
    return { fwd, right };
  }

  private cameraRight() {
    return new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
  }

  /** World point → canvas CSS pixels, or null when behind the camera. */
  private toScreen(p: Vector3): [number, number] | null {
    const v = tmp.copy(p).project(this.camera);
    if (v.z > 1) return null;
    return [((v.x + 1) / 2) * this.size.w, ((1 - v.y) / 2) * this.size.h];
  }

  private updateHandle(focus: number) {
    const el = this.o.handle;
    if (!el) return;
    let state = "off";
    let x = 0;
    let y = 0;
    let r = 0;
    if (this.introT < 0 && focus > 0.6 && !this.lost) {
      const pos = this.world.ball.position;
      const s = this.toScreen(pos);
      if (s && s[0] > -20 && s[0] < this.size.w + 20 && s[1] > -20 && s[1] < this.size.h + 20) {
        const dist = this.camera.position.distanceTo(pos);
        r = (BALL.radius / dist) * (this.size.h / 2 / Math.tan(MathUtils.degToRad(this.camera.fov / 2)));
        if (r > 2.5) {
          [x, y] = s;
          state = `${x.toFixed(1)},${y.toFixed(1)},${r.toFixed(1)}`;
        }
      }
    }
    if (state === this.handleState) return;
    this.handleState = state;
    if (state === "off") {
      el.dataset.on = "false";
      return;
    }
    el.dataset.on = "true";
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    el.style.setProperty("--ball-r", `${r.toFixed(1)}px`);
  }

  private slower() {
    const next = LOWER[this.tier];
    if (!next) {
      this.struggling = true; // keep rendering on demand only
      return;
    }
    this.tier = next;
    this.applyTier();
    this.o.events?.onTier?.(next);
  }

  private applyTier() {
    const s = TIERS[this.tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.pixelRatio));
    this.resize();
    const key = this.world.towers[0].light;
    if (s.shadowMap === 0 && key.castShadow) {
      key.castShadow = false;
      key.shadow.map?.dispose();
      key.shadow.map = null;
      this.renderer.shadowMap.enabled = false;
    } else if (key.castShadow && key.shadow.mapSize.x !== s.shadowMap) {
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.shadow.mapSize.set(s.shadowMap, s.shadowMap);
      this.renderer.shadowMap.needsUpdate = true;
    }
    const grass = this.world.grass;
    if (grass) {
      if (s.grass === 0) this.grassEnabled = false;
      else grass.count = Math.min(grass.count, s.grass);
    }
    this.world.dust.geometry.setDrawRange(0, s.dust);
    for (const t of this.world.towers) t.beams.forEach((b, i) => (b.visible = i === 0 || s.dust >= 600));
    const pr = this.renderer.getPixelRatio();
    this.world.dustMaterial.uniforms.uPixelRatio.value = pr;
    this.world.distant.uniforms.uPixelRatio.value = pr;
    this.governor.reset();
  }

  /** Reflections for the ball: the night sky with the four lamp banks in it. */
  private buildEnvironment() {
    const pmrem = new PMREMGenerator(this.renderer);
    const env = new Scene();
    const dome = new Mesh(new SphereGeometry(50, 32, 16), new MeshBasicMaterial({ color: new Color("#030504"), side: BackSide }));
    env.add(dome);
    const ground = new Mesh(new PlaneGeometry(200, 200), new MeshBasicMaterial({ color: new Color("#0d2410") }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    env.add(ground);
    for (const t of this.world.towers) {
      const panel = new Mesh(new PlaneGeometry(4.5, 3), new MeshBasicMaterial({ color: LAMP_COLOR.clone().multiplyScalar(30) }));
      panel.position.copy(t.lampPos).multiplyScalar(45 / t.lampPos.length());
      panel.lookAt(0, 0, 0);
      env.add(panel);
    }
    const target = pmrem.fromScene(env, 0.02);
    env.traverse((obj) => {
      const mesh = obj as Mesh;
      mesh.geometry?.dispose();
      (mesh.material as MeshBasicMaterial | undefined)?.dispose();
    });
    pmrem.dispose();
    this.envTarget?.dispose();
    this.envTarget = target;
    const ball = this.world.ballMaterial as MeshPhysicalMaterial;
    ball.envMap = target.texture;
    ball.needsUpdate = true;
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.stop();
    if (this.o.handle) this.o.handle.dataset.on = "false";
    this.handleState = "off";
    this.o.events?.onContextLost?.();
  };

  private onRestored = () => {
    this.lost = false;
    this.buildEnvironment();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
    this.handleState = "";
    this.start();
    this.o.events?.onContextRestored?.();
  };
}

