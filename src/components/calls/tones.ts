/**
 * Call sounds, made in the browser (no audio files):
 * - "ring": the incoming call, a bright double chime;
 * - "ringback": what the caller hears while it rings, a 425 Hz tone,
 *   one second on and four off, as on phones in Iraq.
 * Browsers only allow sound after the person has touched the page; when
 * they haven't, this stays silent and the screen still shows the call.
 */
export function playTone(kind: "ring" | "ringback"): { stop: () => void } {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return { stop: () => undefined };
    const ctx = new Context();
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
    const level = kind === "ring" ? 0.12 : 0.07;
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
    return {
      stop: () => {
        try {
          oscillators.forEach((o) => o.stop());
          void ctx.close();
        } catch {
          // already stopped
        }
      },
    };
  } catch {
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
