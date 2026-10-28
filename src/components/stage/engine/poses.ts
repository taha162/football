import { clamp01, ease, lerp, lerp3, mirrorPose, mixPose, Path, smoothstep, type Pose } from "@/lib/stage/camera";
import type { Vec3 } from "@/lib/stage/physics";

/**
 * The shot list. Every scene has a landscape and a portrait framing (phones
 * hold the subject in the upper half, above the copy); the camera blends
 * between them by aspect ratio. Shots are written for left-to-right layouts
 * and mirrored for Arabic, so the subject always sits opposite the text.
 */
export const SCENES = ["pitch", "matches", "squad", "venues", "tournaments", "final"] as const;
export type SceneId = (typeof SCENES)[number];

type Shot = (f: number) => Pose;
interface SceneShot {
  landscape: Shot;
  portrait: Shot;
}

const pose = (p: Vec3, t: Vec3, fov: number, shift: [number, number], roll = 0): Pose => ({ p, t, fov, roll, shift });

const SHOTS: Record<SceneId, SceneShot> = {
  // 01 — On the turf behind the ball, looking down the pitch to the far goal;
  // the key floodlight high on the right.
  pitch: {
    landscape: () => pose([-3.0, 0.5, -1.2], [12, 3.0, 4.2], 50, [0.3, 0]),
    // Phones: standing over the ball, which sits in the top third above the copy.
    portrait: () => pose([-4.7, 1.3, -1.71], [6.58, -0.11, 2.39], 50, [0, 0.55]),
  },
  // 02 — High over the near touchline, drifting along the pitch: the match board.
  matches: {
    landscape: (f) => pose([lerp(-30, -10, f), 32, 30], [lerp(-8, 8, f), 0, -4], 40, [0.26, 0]),
    portrait: (f) => pose([lerp(-16, -4, f), 44, 26], [lerp(-4, 5, f), 0, -2], 48, [0, 0.24]),
  },
  // 03 — The tactics board: high behind the goal, a formation drawn on the grass.
  squad: {
    landscape: () => pose([82, 46, 0], [34, 0, 0], 36, [0.36, 0]),
    portrait: () => pose([84, 66, 0], [33, 0, 0], 50, [0, 0.12]),
  },
  // 04 — A camera on the touchline dolly behind the boards, tracking along the pitch.
  venues: {
    landscape: (f) => pose([lerp(-40, 10, f), 4.2, 41], [lerp(4, 54, f), 0.6, 6], 38, [0.22, 0]),
    portrait: (f) => pose([lerp(-24, 4, f), 6, 41], [lerp(6, 34, f), 0.4, 6], 50, [0, 0.2]),
  },
  // 05 — Behind the net, low, down the full length of the pitch to the far floodlights.
  tournaments: {
    landscape: () => pose([59, 2.4, 6], [-10, 6, -3], 40, [0.2, 0]),
    portrait: () => pose([60, 3.2, 3], [0, 4.5, -1], 56, [0, 0.12]),
  },
  // 06 — Down at the ball's level, the grass close enough to touch; one light still on
  // throws the ball's long shadow back towards the lens.
  final: {
    landscape: () => pose([1.55, 0.34, 0.55], [-10, 1.9, -3.6], 54, [0.28, 0]),
    portrait: () => pose([4.7, 1.3, 1.71], [-6.58, -0.11, -2.39], 50, [0, 0.55]),
  },
};

/** 0 for landscape screens, 1 for tall phone screens. */
export const portraitWeight = (aspect: number) => smoothstep(1.15, 0.7, aspect);

export function sceneShots(m: 1 | -1, aspect: number): ((f: number) => Pose)[] {
  const w = portraitWeight(aspect);
  return SCENES.map((id) => {
    const s = SHOTS[id];
    return (f: number) => mirrorPose(w <= 0 ? s.landscape(f) : w >= 1 ? s.portrait(f) : mixPose(s.landscape(f), s.portrait(f), w), m);
  });
}

/* ------------------------------------------------------------------------
   Opening sequence: from high above the dark stadium down to the turf.
   ------------------------------------------------------------------------ */
export const INTRO = {
  /** Camera move starts after the first lamp bank ignites, and lands on the hero shot. */
  moveStart: 0.25,
  moveDuration: 4.6,
  /** Tower ignition times (s), in tower order: key first. */
  ignite: [0.35, 1.4, 1.9, 2.02],
  boards: 2.3,
  headline: 3.0,
  end: 4.95,
} as const;

/** The intro camera for time t (s); `hero` is the shot it lands on (already framed for this screen). */
export function introCamera(m: 1 | -1, hero: Pose): (t: number) => Pose {
  const heroL = mirrorPose(hero, m); // back to left-to-right space to build the path
  const path = new Path([[-62, 36, -30], [-40, 20, -17], [-19, 7, -7], [-7.5, 1.7, -2.6], heroL.p]);
  // Opens on the key tower, so its first lamp bank ignites in frame, then pans down to the pitch.
  const startTarget: Vec3 = [25, 12, 20];
  return (t: number) => {
    const u = clamp01((t - INTRO.moveStart) / INTRO.moveDuration);
    const e = ease.camera(u);
    const k = ease.inOut(u);
    const p = path.at(e);
    const shot: Pose = {
      p,
      t: lerp3(startTarget, heroL.t, k),
      fov: lerp(54, heroL.fov, e),
      roll: -0.06 * Math.sin(Math.PI * e),
      shift: [heroL.shift[0] * k, heroL.shift[1] * k],
    };
    return mirrorPose(shot, m);
  };
}
