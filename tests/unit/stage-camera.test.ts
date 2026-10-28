import { describe, expect, it } from "vitest";
import { cubicBezier, damp, ease, mirrorPose, Path, scrollPose, type Pose } from "@/lib/stage/camera";
import { FrameGovernor, initialTier, isSoftwareRenderer } from "@/lib/stage/quality";

const pose = (x: number): Pose => ({ p: [x, 0, 0], t: [x, 0, -1], fov: 40, roll: 0, shift: [0.3, 0] });

describe("camera math", () => {
  it("cubic Bézier easing matches its endpoints and is monotonic for camera curves", () => {
    for (const f of [ease.inOut, ease.camera, ease.out, cubicBezier(0.25, 0.1, 0.25, 1)]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      let prev = 0;
      for (let x = 0.01; x <= 1; x += 0.01) {
        const y = f(x);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    }
    // Symmetric curve passes through the middle.
    expect(ease.inOut(0.5)).toBeCloseTo(0.5, 4);
  });

  it("moves along a path at an even pace (arc-length parameterised)", () => {
    // Uneven spacing: a short first segment and a long second one.
    const path = new Path([
      [0, 0, 0],
      [1, 0, 0],
      [11, 0, 0],
    ]);
    expect(path.at(0)).toEqual([0, 0, 0]);
    expect(path.at(1)[0]).toBeCloseTo(11, 5);
    // Halfway along the length is near x = 5.5, not at the middle control point.
    expect(path.at(0.5)[0]).toBeCloseTo(5.5, 0);
    const steps = Array.from({ length: 101 }, (_, i) => path.at(i / 100)[0]);
    const deltas = steps.slice(1).map((x, i) => x - steps[i]);
    // Never backs up, and equal input steps cover (almost) equal distances.
    expect(Math.min(...deltas)).toBeGreaterThan(0);
    expect(Math.max(...deltas) - Math.min(...deltas)).toBeLessThan(0.02);
  });

  it("damps towards a target independently of frame rate", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 4, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = damp(b, 1, 4, 1 / 30);
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeCloseTo(1 - Math.exp(-4), 10);
  });

  it("holds each scene's pose and hands over to the next near the end of its scroll range", () => {
    const scenes = [() => pose(0), () => pose(10), () => pose(20)];
    expect(scrollPose(scenes, 0).p[0]).toBe(0);
    expect(scrollPose(scenes, 0.4).p[0]).toBe(0);
    expect(scrollPose(scenes, 0.999).p[0]).toBeCloseTo(10, 1);
    expect(scrollPose(scenes, 1.2).p[0]).toBe(10);
    expect(scrollPose(scenes, 5).p[0]).toBe(20);
    expect(scrollPose(scenes, -1).p[0]).toBe(0);
  });

  it("mirrors a shot for right-to-left layouts", () => {
    const a: Pose = { p: [1, 2, 3], t: [4, 5, -6], fov: 40, roll: 0.1, shift: [0.3, 0.1] };
    expect(mirrorPose(a, 1)).toBe(a);
    expect(mirrorPose(a, -1)).toEqual({ p: [1, 2, -3], t: [4, 5, 6], fov: 40, roll: -0.1, shift: [-0.3, 0.1] });
  });
});

describe("quality tiers", () => {
  it("chooses a tier from device hints", () => {
    expect(initialTier({ renderer: "Google SwiftShader", coarse: false, pixels: 2e6 })).toBe("low");
    expect(initialTier({ renderer: "ANGLE (NVIDIA GeForce RTX 3070)", memory: 8, cores: 12, coarse: false, pixels: 4e6 })).toBe("high");
    expect(initialTier({ memory: 4, cores: 8, coarse: true, pixels: 3e6 })).toBe("low");
    expect(initialTier({ memory: 8, cores: 8, coarse: true, pixels: 3e6 })).toBe("medium");
    expect(initialTier({ memory: 4, cores: 8, coarse: false, pixels: 3e6 })).toBe("medium");
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Apple M2")).toBe(false);
  });

  it("asks for a lower tier only when the median frame is too slow", () => {
    let slow = 0;
    const g = new FrameGovernor(() => slow++, 26, 30);
    for (let i = 0; i < 45 + 30; i++) g.sample(i % 10 === 0 ? 80 : 16); // occasional hitches only
    expect(slow).toBe(0);
    for (let i = 0; i < 30; i++) g.sample(40);
    expect(slow).toBe(1);
  });
});
