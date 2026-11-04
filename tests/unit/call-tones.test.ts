import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A sound context that follows an iPhone's rule: it starts only during a tap,
 * and once started that way it may start again at any time.
 */
class FakeContext {
  static made: FakeContext[] = [];
  static inTap = false;
  state: "suspended" | "running" | "closed" = "suspended";
  startedInTap = false;
  currentTime = 0;
  destination = {};
  oscillators: { started: boolean; stopped: boolean }[] = [];
  constructor() {
    FakeContext.made.push(this);
  }
  resume() {
    if (!this.startedInTap && !FakeContext.inTap) return Promise.reject(new Error("NotAllowedError"));
    this.startedInTap = true;
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} };
  }
  createGain() {
    return { gain: { value: 0, setTargetAtTime() {} }, connect() {}, disconnect() {} };
  }
  createOscillator() {
    const o = { type: "", frequency: { value: 0 }, started: false, stopped: false, connect() {}, start: () => (o.started = true), stop: () => (o.stopped = true) };
    this.oscillators.push(o);
    return o;
  }
}

const listeners = new Map<string, Set<() => void>>();
function tap(type = "touchend") {
  FakeContext.inTap = true;
  for (const fn of listeners.get(type) ?? []) fn();
  FakeContext.inTap = false;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeContext.made = [];
  listeners.clear();
  vi.resetModules();
  vi.stubGlobal("window", {
    AudioContext: FakeContext,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("call sounds", () => {
  it("a call that comes after a tap rings through the context started during that tap", async () => {
    const { primeSound, playTone } = await import("@/components/calls/tones");
    const unprime = primeSound();
    tap();
    await settle();
    expect(FakeContext.made).toHaveLength(1);
    const ctx = FakeContext.made[0];
    // Started in the tap, then resting: nothing to play yet.
    expect(ctx.startedInTap).toBe(true);
    expect(ctx.state).toBe("suspended");

    // Much later, no tap: the call rings out loud through the same context.
    const ring = playTone("ring");
    await settle();
    expect(FakeContext.made).toHaveLength(1);
    expect(ctx.state).toBe("running");
    expect(ctx.oscillators.filter((o) => o.started)).toHaveLength(2);

    ring.stop();
    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
    expect(ctx.state).toBe("suspended");
    unprime();
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  it("the caller's ringback plays after the tap that placed the call", async () => {
    const { primeSound, playTone } = await import("@/components/calls/tones");
    primeSound();
    tap("click");
    await settle();
    const ringback = playTone("ringback");
    await settle();
    expect(FakeContext.made[0].state).toBe("running");
    expect(FakeContext.made[0].oscillators.filter((o) => o.started)).toHaveLength(1);
    ringback.stop();
  });

  it("before any tap a call can't make sound, and nothing breaks", async () => {
    const { playTone } = await import("@/components/calls/tones");
    const ring = playTone("ring");
    await settle();
    expect(FakeContext.made[0].state).toBe("suspended");
    expect(() => ring.stop()).not.toThrow();
  });
});
