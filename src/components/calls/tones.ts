/**
 * Call sounds, made in the browser (no audio files):
 * - "ring": the incoming call, a bright double chime;
 * - "ringback": what the caller hears while it rings, a 425 Hz tone,
 *   one second on and four off, as on phones in Iraq.
 *
 * Browsers only play sound once the person has touched the page, and an
 * iPhone goes further: a sound context must be *started during* a tap, while
 * a call rings long after any tap. A context made when the call arrives
 * stays silent there. So the page keeps one context, started on the person's
 * first tap (primeSound) and resting between sounds, and every call sound
 * plays through it. Before the first tap a call still shows, silently.
 */

let shared: AudioContext | null = null;
/** The shared context was started inside a tap, so it may play whenever a call comes. */
let primed = false;
/** Sounds playing now; the context rests when there are none. */
let playing = 0;

function contextClass(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function context(): AudioContext | null {
  if (shared && shared.state !== "closed") return shared;
  const Context = contextClass();
  if (!Context) return null;
  try {
    shared = new Context();
    primed = false;
  } catch {
    shared = null;
  }
  return shared;
}

/** A running context with nothing to play keeps the phone's audio awake: let it rest. */
function rest(ctx: AudioContext) {
  if (playing === 0 && ctx.state === "running") void ctx.suspend().catch(() => undefined);
}

/**
 * Starts the call sounds' context on the person's taps and key presses, the
 * only moments an iPhone allows it, so a call that comes later rings out
 * loud. Returns the clean-up.
 */
export function primeSound(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const wake = () => {
    const ctx = context();
    if (!ctx || primed) return;
    try {
      // Older iPhones also need something to play during the tap: one silent sample.
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, 22050);
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // not needed elsewhere
    }
    ctx.resume().then(
      () => {
        primed = true;
        rest(ctx);
      },
      () => undefined,
    );
  };
  const events = ["touchend", "pointerup", "click", "keydown"] as const;
  for (const e of events) window.addEventListener(e, wake, true);
  return () => {
    for (const e of events) window.removeEventListener(e, wake, true);
  };
}

export function playTone(kind: "ring" | "ringback"): { stop: () => void } {
  const ctx = context();
  if (!ctx) return { stop: () => undefined };
  playing++;
  try {
    void ctx.resume().catch(() => undefined);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const frequencies = kind === "ring" ? [880, 1320] : [425];
    const oscillators = frequencies.map((f) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      return o;
    });
    // The incoming ring has to be heard across a room; its two tones together stay below full scale (no distortion).
    const level = kind === "ring" ? 0.22 : 0.07;
    const period = kind === "ring" ? 2.6 : 5;
    const bursts: [number, number][] = kind === "ring" ? [[0, 0.35], [0.5, 0.85]] : [[0, 1]];
    const start = ctx.currentTime + 0.05;
    // About a minute of the pattern; calls ring for less than that.
    for (let i = 0; i < Math.ceil(70 / period); i++) {
      for (const [on, off] of bursts) {
        gain.gain.setTargetAtTime(level, start + i * period + on, 0.01);
        gain.gain.setTargetAtTime(0, start + i * period + off, 0.02);
      }
    }
    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          oscillators.forEach((o) => o.stop());
          gain.disconnect();
        } catch {
          // already stopped
        }
        playing = Math.max(0, playing - 1);
        rest(ctx);
      },
    };
  } catch {
    playing = Math.max(0, playing - 1);
    return { stop: () => undefined };
  }
}

/** Buzzes an Android phone in a ring pattern until stopped (iPhones don't allow it). */
export function vibrateRing(): { stop: () => void } {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return { stop: () => undefined };
  const buzz = () => {
    try {
      navigator.vibrate([400, 200, 400]);
    } catch {
      // not allowed before the first touch
    }
  };
  buzz();
  const id = window.setInterval(buzz, 2600);
  return {
    stop: () => {
      window.clearInterval(id);
      try {
        navigator.vibrate(0);
      } catch {
        // ignore
      }
    },
  };
}
