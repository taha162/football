import { describe, expect, it } from "vitest";
import {
  applyImpulse,
  BALL,
  createBall,
  energy,
  GOAL,
  kickFromFlick,
  PITCH,
  step,
  SURFACES,
  type BallState,
  type Contact,
} from "@/lib/stage/physics";

const DT = 1 / 60;
const R = BALL.radius;

function run(b: BallState, seconds: number, each?: (b: BallState, t: number) => void, onContact?: (c: Contact) => void) {
  for (let t = 0; t < seconds; t += DT) {
    step(b, DT, onContact);
    each?.(b, t);
  }
}

const speedOf = (b: BallState) => Math.hypot(b.v[0], b.v[1], b.v[2]);
const slipOf = (b: BallState) => Math.hypot(b.v[0] + b.w[2] * R, b.v[2] - b.w[0] * R);

describe("ball physics", () => {
  it("bounces with the ground's restitution and comes to rest", () => {
    const b = createBall([0, 1 + R, 0]);
    b.asleep = false;
    const apexes: number[] = [];
    let rising = false;
    let last = b.p[1];
    run(b, 12, (s) => {
      if (s.p[1] > last) rising = true;
      else if (rising && s.p[1] < last) {
        apexes.push(last - R);
        rising = false;
      }
      last = s.p[1];
    });
    // First rebound apex ≈ e² × drop height (a little less: air drag).
    const e = SURFACES.ground.restitution;
    expect(apexes[0]).toBeGreaterThan(e * e * 0.85);
    expect(apexes[0]).toBeLessThan(e * e * 1.02);
    // Discrete impacts keep the next ratio within ~10% of e².
    expect(apexes[1]).toBeLessThan(apexes[0] * e * e * 1.1);
    expect(b.asleep).toBe(true);
    expect(b.p[1]).toBeCloseTo(R, 6);
    expect(speedOf(b)).toBe(0);
  });

  it("a ball struck without spin slides, then rolls at ~0.6 of its launch speed (hollow sphere)", () => {
    const b = createBall();
    b.asleep = false;
    b.v = [6, 0, 0];
    let onset: number | null = null;
    run(b, 3, (s) => {
      // Turf resistance re-creates a few mm/s of slip each step, which friction removes.
      if (onset === null && slipOf(s) < 0.01) onset = s.v[0];
    });
    // Theory without turf resistance: v = v0 / (1 + I/mr²) = 0.6 v0 = 3.6 m/s;
    // the turf takes a little more while it slides.
    expect(onset).not.toBeNull();
    expect(onset!).toBeGreaterThan(3.1);
    expect(onset!).toBeLessThan(3.6);
  });

  it("rolls without slipping and slows smoothly to a complete stop", () => {
    const b = createBall();
    b.asleep = false;
    b.v = [5, 0, 0];
    b.w = [0, 0, -5 / R]; // already rolling
    let prev = speedOf(b);
    let monotonic = true;
    let maxSlip = 0;
    const x0 = b.p[0];
    let seconds = 0;
    while (!b.asleep && seconds < 60) {
      step(b, DT);
      seconds += DT;
      const v = speedOf(b);
      if (v > prev + 1e-9) monotonic = false;
      prev = v;
      maxSlip = Math.max(maxSlip, slipOf(b));
    }
    expect(b.asleep).toBe(true);
    expect(monotonic).toBe(true);
    expect(maxSlip).toBeLessThan(0.01);
    const distance = b.p[0] - x0;
    expect(distance).toBeGreaterThan(8);
    expect(distance).toBeLessThan(40);
    expect(seconds).toBeGreaterThan(3);
    expect(b.v).toEqual([0, 0, 0]);
    expect(b.w).toEqual([0, 0, 0]);
  });

  it("never gains energy, whatever it hits", () => {
    const b = createBall([0, R, 0]);
    let prev = energy(b);
    const kicks: [number, number][] = [[14, 3], [-9, 11], [4, -18], [20, 0.5]];
    for (const [dx, dz] of kicks) {
      const { impulse, offset } = kickFromFlick([dx, dz]);
      applyImpulse(b, impulse, offset);
      prev = energy(b);
      run(b, 6, (s) => {
        const e = energy(s);
        expect(e).toBeLessThanOrEqual(prev + 1e-3);
        prev = e;
      });
    }
  });

  it("rebounds off the advertising boards and never passes them", () => {
    // Well clear of the goal mouth (a ball at z = 0 would end up in the net).
    const b = createBall([PITCH.halfLength - 2, R, 20]);
    const boardX = PITCH.halfLength + SURFACES.boards.inset;
    applyImpulse(b, [BALL.mass * 12, 0, 0]);
    const contacts: Contact[] = [];
    let maxX = -Infinity;
    run(b, 4, (s) => (maxX = Math.max(maxX, s.p[0])), (c) => contacts.push(c));
    expect(maxX).toBeLessThanOrEqual(boardX - R + 1e-9);
    expect(contacts.some((c) => c.kind === "board")).toBe(true);
    expect(b.v[0]).toBeLessThanOrEqual(0);
  });

  it("rebounds off a post", () => {
    const postZ = GOAL.halfWidth + GOAL.postRadius;
    const b = createBall([PITCH.halfLength - 6, R, postZ]);
    applyImpulse(b, [BALL.mass * 10, 0, 0]);
    let minGap = Infinity;
    const contacts: Contact[] = [];
    run(
      b,
      2,
      (s) => {
        if (s.p[1] < GOAL.height) minGap = Math.min(minGap, Math.hypot(s.p[0] - PITCH.halfLength, s.p[2] - postZ));
      },
      (c) => contacts.push(c),
    );
    expect(contacts.some((c) => c.kind === "post")).toBe(true);
    expect(minGap).toBeGreaterThan(R + GOAL.postRadius - 0.02);
    expect(b.p[0]).toBeLessThan(PITCH.halfLength);
  });

  it("a shot into the goal is caught by the net", () => {
    const b = createBall([PITCH.halfLength - 12, R, 0.5]);
    applyImpulse(b, [BALL.mass * 18, BALL.mass * 3, 0]);
    let maxX = -Infinity;
    run(b, 6, (s) => (maxX = Math.max(maxX, s.p[0])));
    expect(maxX).toBeLessThanOrEqual(PITCH.halfLength + GOAL.depth - R + 1e-9);
    expect(b.p[0]).toBeGreaterThan(PITCH.halfLength);
    expect(Math.abs(b.p[2])).toBeLessThan(GOAL.halfWidth);
    expect(speedOf(b)).toBeLessThan(0.5);
  });

  it("turns flicks into bounded kicks with a little backspin", () => {
    expect(kickFromFlick([0.01, 0]).impulse).toEqual([0, 0, 0]);
    const soft = kickFromFlick([3, 4]);
    expect(Math.hypot(...soft.impulse) / BALL.mass).toBeCloseTo(5, 5);
    expect(soft.impulse[1]).toBe(0);
    const hard = kickFromFlick([100, 0]);
    expect(hard.impulse[0] / BALL.mass).toBeLessThanOrEqual(22);
    expect(hard.impulse[1]).toBeGreaterThan(0);
    const b = createBall();
    applyImpulse(b, soft.impulse, soft.offset);
    // Struck below the centre: the spin opposes rolling (backspin).
    const rollingSpinZ = -b.v[0] / R;
    expect(Math.sign(b.w[2])).not.toBe(Math.sign(rollingSpinZ));
  });

  it("is deterministic", () => {
    const a = createBall();
    const c = createBall();
    for (const b of [a, c]) {
      const k = kickFromFlick([7, -3]);
      applyImpulse(b, k.impulse, k.offset);
      run(b, 5);
    }
    expect(a.p).toEqual(c.p);
    expect(a.q).toEqual(c.q);
  });
});
