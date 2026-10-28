/**
 * Rigid-body simulation of a football on a grass pitch.
 *
 * A purpose-built solver for one sphere is both lighter and more faithful
 * than a general engine here: it models what makes a football look right on
 * grass — Coulomb friction at the contact point (a kicked ball first slides,
 * then spins up until it rolls without slipping), rolling resistance of the
 * turf, air drag and a little Magnus lift — with impulse-based contacts
 * against the ground, the advertising boards, the goal frame and the nets.
 *
 * Units: metres, seconds, kilograms. World: y up, the pitch centred on the
 * origin, length along x (±52.5 m), width along z (±34 m).
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const BALL = {
  radius: 0.11,
  mass: 0.43,
  /** Thin spherical shell: I = 2/3 m r². */
  inertia: (2 / 3) * 0.43 * 0.11 * 0.11,
} as const;

export const PITCH = { halfLength: 52.5, halfWidth: 34 } as const;
export const GOAL = { halfWidth: 3.66, height: 2.44, depth: 2, postRadius: 0.06 } as const;

export interface Surfaces {
  gravity: number;
  /** Air: 0.5 ρ Cd A / m. */
  dragK: number;
  /** Magnus: a = magnusK (ω × v) while airborne. */
  magnusK: number;
  ground: { restitution: number; friction: number; rollingResistance: number; linearDamping: number; spinDamping: number };
  boards: { restitution: number; friction: number; inset: number; height: number };
  posts: { restitution: number };
  net: { restitution: number; damping: number };
  maxSpeed: number;
}

export const SURFACES: Surfaces = {
  gravity: 9.81,
  dragK: (0.5 * 1.2 * 0.25 * Math.PI * BALL.radius * BALL.radius) / BALL.mass,
  magnusK: 0.0075,
  // Natural grass: low bounce, high rolling resistance compared with a hard floor.
  ground: { restitution: 0.58, friction: 0.5, rollingResistance: 0.06, linearDamping: 0.12, spinDamping: 2.5 },
  // Boards stand a few metres outside the touch and goal lines.
  boards: { restitution: 0.45, friction: 0.3, inset: 4, height: 0.9 },
  posts: { restitution: 0.62 },
  net: { restitution: 0.08, damping: 6 },
  maxSpeed: 26,
};

export type ContactKind = "ground" | "board" | "post" | "net";

export interface BallState {
  p: Vec3;
  v: Vec3;
  w: Vec3;
  q: Quat;
  /** True once the ball has come to rest; integration is skipped until woken. */
  asleep: boolean;
  /** True while touching the ground this step. */
  grounded: boolean;
}

export interface Contact {
  kind: ContactKind;
  /** Closing speed along the contact normal, m/s. */
  speed: number;
}

// --- small vector helpers (allocation-free variants where it matters) -----
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function createBall(p: Vec3 = [0, BALL.radius, 0]): BallState {
  return { p: [...p], v: [0, 0, 0], w: [0, 0, 0], q: [0, 0, 0, 1], asleep: true, grounded: true };
}

/** Puts the ball at rest at a point on the ground (e.g. back on the centre spot). */
export function placeBall(b: BallState, x: number, z: number) {
  b.p = [x, BALL.radius, z];
  b.v = [0, 0, 0];
  b.w = [0, 0, 0];
  b.asleep = true;
  b.grounded = true;
}

/** Kinetic + potential energy, J (used by tests and for sanity checks). */
export function energy(b: BallState, s: Surfaces = SURFACES): number {
  return 0.5 * BALL.mass * dot(b.v, b.v) + 0.5 * BALL.inertia * dot(b.w, b.w) + BALL.mass * s.gravity * (b.p[1] - BALL.radius);
}

/**
 * Applies an impulse J (N·s) at a point offset from the ball's centre
 * (world-space, metres). An off-centre impulse also sets the ball spinning.
 */
export function applyImpulse(b: BallState, J: Vec3, offset: Vec3 = [0, 0, 0], s: Surfaces = SURFACES) {
  b.v = add(b.v, scale(J, 1 / BALL.mass));
  b.w = add(b.w, scale(cross(offset, J), 1 / BALL.inertia));
  const speed = len(b.v);
  if (speed > s.maxSpeed) b.v = scale(b.v, s.maxSpeed / speed);
  b.asleep = false;
}

/**
 * Resolves one contact with outward normal n (unit, pointing from the
 * surface towards the ball centre). Returns the closing speed, or 0 when the
 * ball is already separating.
 */
function resolveContact(b: BallState, n: Vec3, restitution: number, friction: number): number {
  const r: Vec3 = scale(n, -BALL.radius); // centre → contact point
  const vn = dot(b.v, n);
  let jn = 0;
  if (vn < 0) {
    // Gentle impacts do not bounce: this is what lets the ball settle.
    const e = -vn < 0.45 ? 0 : restitution;
    jn = -(1 + e) * vn * BALL.mass;
    b.v = add(b.v, scale(n, jn / BALL.mass));
  }
  // Gravity is applied before contacts, so for a resting ball jn is exactly its
  // weight over the step: Coulomb friction then scales with the true load.
  const normalImpulse = jn;
  // Velocity of the contact point, tangential part.
  const vc = add(b.v, cross(b.w, r));
  const vct = sub(vc, scale(n, dot(vc, n)));
  const slip = len(vct);
  if (slip > 1e-9 && normalImpulse > 0) {
    // Effective mass of the contact along the tangent: 1/m + r²/I.
    const kT = 1 / BALL.mass + (BALL.radius * BALL.radius) / BALL.inertia;
    const jt = Math.min(slip / kT, friction * normalImpulse);
    const J = scale(vct, -jt / slip);
    b.v = add(b.v, scale(J, 1 / BALL.mass));
    b.w = add(b.w, scale(cross(r, J), 1 / BALL.inertia));
  }
  return vn < 0 ? -vn : 0;
}

function closestOnSegment(p: Vec3, a: Vec3, c: Vec3): Vec3 {
  const ab = sub(c, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return add(a, scale(ab, t));
}

/** Goal frame as capsules: two posts and the crossbar at each end. */
export function goalFrame(): [Vec3, Vec3][] {
  const segs: [Vec3, Vec3][] = [];
  for (const side of [-1, 1]) {
    const x = side * PITCH.halfLength;
    const z = GOAL.halfWidth + GOAL.postRadius;
    const h = GOAL.height + GOAL.postRadius;
    segs.push([[x, 0, -z], [x, h, -z]], [[x, 0, z], [x, h, z]], [[x, h, -z], [x, h, z]]);
  }
  return segs;
}
const FRAME = goalFrame();

/** The goal net as thin two-sided panels: back, both sides and the roof. */
interface Panel {
  axis: 0 | 1 | 2;
  at: number;
  /** Bounds on the two other axes, as [axis, min, max]. */
  bounds: [number, number, number][];
}
const NETS: Panel[] = [-1, 1].flatMap((side) => {
  const line = side * PITCH.halfLength;
  const back = side * (PITCH.halfLength + GOAL.depth);
  const [x0, x1] = side < 0 ? [back, line] : [line, back];
  return [
    { axis: 0, at: back, bounds: [[2, -GOAL.halfWidth, GOAL.halfWidth], [1, 0, GOAL.height]] },
    { axis: 2, at: -GOAL.halfWidth, bounds: [[0, x0, x1], [1, 0, GOAL.height]] },
    { axis: 2, at: GOAL.halfWidth, bounds: [[0, x0, x1], [1, 0, GOAL.height]] },
    { axis: 1, at: GOAL.height, bounds: [[0, x0, x1], [2, -GOAL.halfWidth, GOAL.halfWidth]] },
  ] satisfies Panel[];
});

function insideGoal(p: Vec3): boolean {
  const beyond = Math.abs(p[0]) - PITCH.halfLength;
  return beyond > 0 && beyond < GOAL.depth && Math.abs(p[2]) < GOAL.halfWidth && p[1] < GOAL.height;
}

/**
 * Advances the simulation by dt seconds using fixed substeps. Calls onContact
 * for impacts (closing speed > 0.3 m/s) so the scene can react with sound or
 * by bending the grass.
 */
export function step(b: BallState, dt: number, onContact?: (c: Contact) => void, s: Surfaces = SURFACES, substep = 1 / 240) {
  if (b.asleep) return;
  let remaining = Math.min(dt, 0.1); // never try to catch up after a stalled tab
  while (remaining > 1e-9) {
    const h = Math.min(substep, remaining);
    remaining -= h;
    substepBall(b, h, onContact, s);
    if (b.asleep) return;
  }
}

function substepBall(b: BallState, h: number, onContact: ((c: Contact) => void) | undefined, s: Surfaces) {
  const R = BALL.radius;
  const touching = b.p[1] - R <= 1e-3;

  // External forces: gravity, drag, and Magnus lift while airborne.
  const speed = len(b.v);
  let a: Vec3 = [0, -s.gravity, 0];
  a = add(a, scale(b.v, -s.dragK * speed));
  if (!touching) a = add(a, scale(cross(b.w, b.v), s.magnusK));
  b.v = add(b.v, scale(a, h));

  // Ground.
  b.grounded = false;
  if (b.p[1] + b.v[1] * h - R <= 0) {
    const closing = resolveContact(b, [0, 1, 0], s.ground.restitution, s.ground.friction);
    if (closing > 0.3) onContact?.({ kind: "ground", speed: closing });
    b.grounded = b.v[1] <= 1e-6;
    if (b.grounded) {
      b.v[1] = 0;
      // Resting contact: seat the ball on the turf (the gap is under one step of travel).
      b.p[1] = R;
      // Rolling resistance and grass drag act against the direction of travel…
      const vt = Math.hypot(b.v[0], b.v[2]);
      if (vt > 0) {
        const dv = Math.min(vt, (s.ground.rollingResistance * s.gravity + s.ground.linearDamping * vt) * h);
        const k = (vt - dv) / vt;
        b.v[0] *= k;
        b.v[2] *= k;
      }
      // …and the turf damps spin about the vertical axis.
      b.w[1] *= Math.exp(-s.ground.spinDamping * h);
      // No explicit "rolling" switch: Coulomb friction at the contact removes any
      // slip every step, so a kicked ball slides, spins up and then rolls, and the
      // resistance above slows translation and spin together.
    }
  }

  // Advertising boards: four vertical planes, a little outside the lines. The
  // boundary has no top (ball-stop netting above the boards), so a lofted ball
  // can never leave the stadium.
  const bx = PITCH.halfLength + s.boards.inset;
  const bz = PITCH.halfWidth + s.boards.inset;
  const planes: [number, number, Vec3][] = [
    [0, -bx, [1, 0, 0]],
    [0, bx, [-1, 0, 0]],
    [2, -bz, [0, 0, 1]],
    [2, bz, [0, 0, -1]],
  ];
  for (const [axis, at, n] of planes) {
    const dist = (b.p[axis] - at) * n[axis];
    if (dist - R <= 0) {
      const closing = resolveContact(b, n, s.boards.restitution, s.boards.friction);
      if (closing > 0.3) onContact?.({ kind: "board", speed: closing });
      b.p[axis] = at + n[axis] * R; // never let the ball sit inside a board
    }
  }

  // Goal frame (posts and crossbars as capsules).
  for (const [a0, a1] of FRAME) {
    const c = closestOnSegment(b.p, a0, a1);
    const d = sub(b.p, c);
    const dist = len(d);
    const minDist = R + GOAL.postRadius;
    if (dist < minDist && dist > 1e-6) {
      const n = scale(d, 1 / dist);
      const closing = resolveContact(b, n, s.posts.restitution, 0.2);
      if (closing > 0.3) onContact?.({ kind: "post", speed: closing });
      b.p = add(c, scale(n, minDist));
    }
  }

  // Nets: soft panels that absorb the ball, plus drag while it is inside the goal.
  for (const net of NETS) {
    if (!net.bounds.every(([ax, lo, hi]) => b.p[ax] >= lo && b.p[ax] <= hi)) continue;
    const d = b.p[net.axis] - net.at;
    if (Math.abs(d) < BALL.radius) {
      const n: Vec3 = [0, 0, 0];
      n[net.axis] = d >= 0 ? 1 : -1;
      const closing = resolveContact(b, n, s.net.restitution, 0.6);
      if (closing > 0.3) onContact?.({ kind: "net", speed: closing });
      b.p[net.axis] = net.at + n[net.axis] * BALL.radius;
    }
  }
  if (insideGoal(b.p)) {
    const k = Math.exp(-s.net.damping * h);
    b.v[0] *= k;
    b.v[2] *= k;
    b.w = scale(b.w, k);
  }

  // Integrate position and orientation.
  b.p = add(b.p, scale(b.v, h));
  if (b.p[1] < R) b.p[1] = R;
  integrateOrientation(b.q, b.w, h);

  // Sleep once the ball is effectively at rest on the ground.
  if (b.grounded && len(b.v) < 0.015 && len(b.w) < 0.15) {
    b.v = [0, 0, 0];
    b.w = [0, 0, 0];
    b.asleep = true;
  }
}

/** q ← q + ½ (ω, 0) ⊗ q · dt, normalised. */
export function integrateOrientation(q: Quat, w: Vec3, h: number) {
  const [x, y, z, qw] = q;
  const hx = 0.5 * h * w[0];
  const hy = 0.5 * h * w[1];
  const hz = 0.5 * h * w[2];
  q[0] = x + hx * qw + hy * z - hz * y;
  q[1] = y + hy * qw + hz * x - hx * z;
  q[2] = z + hz * qw + hx * y - hy * x;
  q[3] = qw - hx * x - hy * y - hz * z;
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= n;
  q[1] /= n;
  q[2] /= n;
  q[3] /= n;
}

/**
 * Turns a flick (ground-plane drag velocity, m/s) into a kick impulse: mostly
 * along the ground with a little lift that grows with power, struck slightly
 * below centre so the ball leaves with a touch of backspin.
 */
export function kickFromFlick(dragVelocity: [number, number], strength = 1): { impulse: Vec3; offset: Vec3 } {
  const [dx, dz] = dragVelocity;
  const speed = Math.min(Math.hypot(dx, dz) * strength, 22);
  if (speed < 0.05) return { impulse: [0, 0, 0], offset: [0, 0, 0] };
  const ux = dx / Math.hypot(dx, dz);
  const uz = dz / Math.hypot(dx, dz);
  const lift = speed > 9 ? Math.min(0.35, (speed - 9) * 0.04) : 0;
  const v: Vec3 = [ux * speed, speed * lift, uz * speed];
  const impulse = scale(v, BALL.mass);
  // Contact behind and slightly below the centre.
  const offset: Vec3 = [-ux * BALL.radius * 0.99, -BALL.radius * 0.1, -uz * BALL.radius * 0.99];
  return { impulse, offset };
}
