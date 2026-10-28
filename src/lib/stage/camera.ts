import type { Vec3 } from "./physics";

/**
 * A camera pose: position, look-at target, vertical field of view (deg),
 * roll (rad) and lens shift — where the target lands on screen, in
 * normalised device units (a shift lens composes around text without
 * turning the camera away from its subject).
 */
export interface Pose {
  p: Vec3;
  t: Vec3;
  fov: number;
  roll: number;
  shift: [number, number];
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    p: lerp3(a.p, b.p, t),
    t: lerp3(a.t, b.t, t),
    fov: lerp(a.fov, b.fov, t),
    roll: lerp(a.roll, b.roll, t),
    shift: [lerp(a.shift[0], b.shift[0], t), lerp(a.shift[1], b.shift[1], t)],
  };
}

/** The same shot reflected across the pitch's long axis (z → −z): the screen image mirrors. */
export function mirrorPose(a: Pose, m: 1 | -1): Pose {
  if (m === 1) return a;
  return { p: [a.p[0], a.p[1], -a.p[2]], t: [a.t[0], a.t[1], -a.t[2]], fov: a.fov, roll: -a.roll, shift: [-a.shift[0], a.shift[1]] };
}

/** CSS-style cubic Bézier easing (x1, y1, x2, y2), solved for x with Newton steps. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Fall back to bisection if Newton wandered off.
    if (t < 0 || t > 1 || Math.abs(sampleX(t) - x) > 1e-4) {
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (sampleX(t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sampleY(t);
  };
}

export const ease = {
  /** Symmetric, for transitions. */
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  /** Heavy camera: slow to start, long settle (the move has mass). */
  camera: cubicBezier(0.6, 0.02, 0.12, 1),
  /** Quick out, for interface feedback. */
  out: cubicBezier(0.16, 1, 0.3, 1),
};

/**
 * Centripetal Catmull–Rom path through control points, reparameterised by arc length so a
 * linear input moves the camera at an even pace regardless of point spacing.
 */
export class Path {
  private readonly lut: { u: number; s: number }[] = [];
  private readonly total: number;

  constructor(private readonly pts: Vec3[], samples = 240) {
    let prev = this.raw(0);
    let acc = 0;
    this.lut.push({ u: 0, s: 0 });
    for (let i = 1; i <= samples; i++) {
      const u = i / samples;
      const cur = this.raw(u);
      acc += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
      this.lut.push({ u, s: acc });
      prev = cur;
    }
    this.total = acc;
  }

  get length() {
    return this.total;
  }

  /** Point at fraction `d` (0..1) of the path's length. */
  at(d: number): Vec3 {
    const target = clamp01(d) * this.total;
    let lo = 0;
    let hi = this.lut.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.lut[mid].s < target) lo = mid;
      else hi = mid;
    }
    const a = this.lut[lo];
    const b = this.lut[hi];
    const f = b.s === a.s ? 0 : (target - a.s) / (b.s - a.s);
    return this.raw(lerp(a.u, b.u, f));
  }

  /** Centripetal Catmull–Rom (α = ½): no cusps, loops or overshoot with uneven spacing. */
  private raw(u: number): Vec3 {
    const pts = this.pts;
    const n = pts.length - 1;
    const x = clamp01(u) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const f = x - i;
    // Virtual end points mirror the neighbours so the ends have natural tangents.
    const p0 = i > 0 ? pts[i - 1] : mirror(pts[0], pts[1]);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 <= n ? pts[i + 2] : mirror(pts[n], pts[n - 1]);
    const knot = (a: Vec3, b: Vec3) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const t = t1 + (t2 - t1) * f;
    const out: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a1 = ((t1 - t) / (t1 - t0)) * p0[k] + ((t - t0) / (t1 - t0)) * p1[k];
      const a2 = ((t2 - t) / (t2 - t1)) * p1[k] + ((t - t1) / (t2 - t1)) * p2[k];
      const a3 = ((t3 - t) / (t3 - t2)) * p2[k] + ((t - t2) / (t3 - t2)) * p3[k];
      const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
      const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
      out[k] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
    }
    return out;
  }
}

const mirror = (end: Vec3, next: Vec3): Vec3 => [2 * end[0] - next[0], 2 * end[1] - next[1], 2 * end[2] - next[2]];

/** Frame-rate independent exponential approach towards a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) => target + (current - target) * Math.exp(-lambda * dt);

export function damp3(current: Vec3, target: Vec3, lambda: number, dt: number) {
  const k = Math.exp(-lambda * dt);
  current[0] = target[0] + (current[0] - target[0]) * k;
  current[1] = target[1] + (current[1] - target[1]) * k;
  current[2] = target[2] + (current[2] - target[2]) * k;
}

/**
 * Scroll position → pose. Each scene holds its own pose (optionally moving
 * through it as the scene scrolls) and hands over to the next scene's pose in
 * the last part of its scroll range, so the camera arrives as the next
 * section's content arrives.
 */
export function scrollPose(scenes: ((f: number) => Pose)[], s: number, handover = 0.55): Pose {
  const last = scenes.length - 1;
  const clamped = Math.min(Math.max(s, 0), last + 0.999);
  const i = Math.min(last, Math.floor(clamped));
  const f = clamped - i;
  const here = scenes[i](f);
  if (i === last) return here;
  const k = ease.inOut(smoothstep(handover, 1, f));
  return k > 0 ? mixPose(here, scenes[i + 1](0), k) : here;
}
