/**
 * Rendering quality tiers and the runtime governor that steps them down when
 * a device cannot hold a smooth frame rate.
 */
export type Tier = "high" | "medium" | "low";

export interface TierSettings {
  /** Upper bound for the device pixel ratio. */
  pixelRatio: number;
  /** Shadow map size, or 0 to rely on the contact shadow only. */
  shadowMap: number;
  /** Instanced grass blades around the centre spot. */
  grass: number;
  /** Dust motes in the floodlight beams. */
  dust: number;
  antialias: boolean;
  /** Geometric detail of the ball. */
  ballSegments: number;
}

export const TIERS: Record<Tier, TierSettings> = {
  high: { pixelRatio: 2, shadowMap: 2048, grass: 70000, dust: 1100, antialias: true, ballSegments: 96 },
  medium: { pixelRatio: 1.5, shadowMap: 1024, grass: 26000, dust: 600, antialias: true, ballSegments: 64 },
  low: { pixelRatio: 1, shadowMap: 0, grass: 0, dust: 260, antialias: false, ballSegments: 48 },
};

export const LOWER: Record<Tier, Tier | null> = { high: "medium", medium: "low", low: null };

export interface DeviceInfo {
  /** Unmasked GPU renderer string, when the browser exposes it. */
  renderer?: string;
  /** navigator.deviceMemory (GB), when available. */
  memory?: number;
  cores?: number;
  /** Primary pointer is coarse (phones, most tablets). */
  coarse: boolean;
  /** Viewport size in CSS pixels × devicePixelRatio². */
  pixels: number;
}

export function isSoftwareRenderer(renderer = ""): boolean {
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer);
}

/** A starting tier from what the device tells us; the governor corrects it with real frame times. */
export function initialTier(d: DeviceInfo): Tier {
  if (isSoftwareRenderer(d.renderer)) return "low";
  if ((d.memory !== undefined && d.memory <= 2) || (d.cores !== undefined && d.cores <= 2)) return "low";
  if (d.coarse) return (d.memory ?? 4) >= 6 && (d.cores ?? 4) >= 6 ? "medium" : "low";
  if ((d.memory !== undefined && d.memory <= 4) || d.pixels > 9_000_000) return "medium";
  return "high";
}

/**
 * Watches frame times. When the average over a window is too slow it asks for
 * the next lower tier; at the lowest tier it reports `struggling` so the host
 * can stop continuous animation and render only on demand.
 */
export class FrameGovernor {
  private samples: number[] = [];
  private settleFrames = 45; // ignore shader compilation and the first frames after a change

  constructor(
    private readonly onSlow: () => void,
    private readonly budgetMs = 26,
    private readonly window = 90,
  ) {}

  /** Call once per rendered frame with the frame's duration in ms. */
  sample(ms: number) {
    if (this.settleFrames > 0) {
      this.settleFrames--;
      return;
    }
    this.samples.push(ms);
    if (this.samples.length < this.window) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    // Median: robust against one-off hitches (GC, tab switches).
    const median = sorted[sorted.length >> 1];
    this.samples = [];
    if (median > this.budgetMs) {
      this.settleFrames = 60;
      this.onSlow();
    }
  }

  reset() {
    this.samples = [];
    this.settleFrames = 45;
  }
}
