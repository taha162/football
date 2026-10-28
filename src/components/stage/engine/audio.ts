import type { ContactKind } from "@/lib/stage/physics";

/**
 * Stadium sound, synthesised (no audio files): night air, the hum of the
 * floodlight ballasts, the contactors that switch each bank on, and the
 * ball — kick, bounce, post, net, boards. Silent until the visitor turns it
 * on; the AudioContext is only created inside that click.
 */
export class StageAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lights = 0;
  enabled = false;

  async enable() {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    await ctx.resume();
    this.master!.gain.cancelScheduledValues(ctx.currentTime);
    this.master!.gain.setTargetAtTime(0.9, ctx.currentTime, 0.2);
    this.enabled = true;
    this.setLights(this.lights);
  }

  disable() {
    this.enabled = false;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    window.setTimeout(() => {
      if (!this.enabled) void ctx.suspend();
    }, 500);
  }

  /** Silence while the stage is off screen or the tab is hidden; resume where the visitor left it. */
  setActive(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) void ctx.suspend();
    else if (this.enabled) void ctx.resume();
  }

  /** Overall floodlight output, 0..1+ (drives the ballast hum). */
  setLights(level: number) {
    this.lights = level;
    if (!this.ctx || !this.hum) return;
    this.hum.gain.setTargetAtTime(Math.min(1.3, level) * 0.014, this.ctx.currentTime, 0.25);
  }

  /** A lamp bank's contactor closing. */
  clunk() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseHit(t, { type: "lowpass", freq: 260, q: 0.7 }, 0.5, 0.004, 0.09);
    this.noiseHit(t, { type: "highpass", freq: 2800, q: 0.7 }, 0.12, 0.001, 0.012);
    this.tone(t, 52, 46, 0.35, 0.004, 0.42);
  }

  kick(speed: number) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = Math.min(1, speed / 18);
    this.tone(t, 170, 58, 0.25 + 0.55 * k, 0.003, 0.12);
    this.noiseHit(t, { type: "bandpass", freq: 1300, q: 0.9 }, 0.18 + 0.4 * k, 0.001, 0.035);
  }

  contact(kind: ContactKind, speed: number) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = Math.min(1, speed / 10);
    if (k < 0.04) return;
    switch (kind) {
      case "ground":
        this.tone(t, 120, 62, 0.35 * k, 0.002, 0.09);
        this.noiseHit(t, { type: "lowpass", freq: 700, q: 0.7 }, 0.18 * k, 0.001, 0.05);
        break;
      case "post":
        // Inharmonic partials of a struck steel tube.
        for (const [f, a, d] of [
          [430, 0.5, 1.4],
          [1003, 0.32, 0.9],
          [1830, 0.2, 0.55],
          [2850, 0.12, 0.3],
        ] as const)
          this.tone(t, f, f, a * k, 0.001, d, "sine");
        this.noiseHit(t, { type: "highpass", freq: 2200, q: 0.7 }, 0.25 * k, 0.001, 0.02);
        break;
      case "net":
        this.noiseHit(t, { type: "bandpass", freq: 2400, q: 0.5 }, 0.3 * k, 0.01, 0.32);
        this.tone(t, 75, 60, 0.22 * k, 0.005, 0.16);
        break;
      case "board":
        this.tone(t, 125, 95, 0.38 * k, 0.002, 0.16, "triangle");
        this.noiseHit(t, { type: "lowpass", freq: 950, q: 0.8 }, 0.3 * k, 0.001, 0.09);
        break;
    }
  }

  dispose() {
    this.enabled = false;
    void this.ctx?.close();
    this.ctx = null;
  }

  /* -------------------------------------------------------------------- */

  private live(): AudioContext | null {
    return this.enabled && this.ctx && this.ctx.state === "running" ? this.ctx : null;
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);
    this.master = master;

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    // Night air: brown-ish noise, slowly breathing.
    const air = ctx.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "lowpass";
    airFilter.frequency.value = 340;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.02;
    lfo.connect(lfoDepth).connect(airGain.gain);
    air.connect(airFilter).connect(airGain).connect(master);
    air.start();
    lfo.start();

    // Ballast hum: twice the 50 Hz mains frequency, with harmonics.
    const hum = ctx.createGain();
    hum.gain.value = 0;
    hum.connect(master);
    for (const [f, a] of [
      [100, 1],
      [200, 0.45],
      [300, 0.18],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(hum);
      o.start();
    }
    this.hum = hum;
  }

  private tone(t: number, f0: number, f1: number, level: number, attack: number, decay: number, type: OscillatorType = "sine") {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    o.onended = () => g.disconnect();
  }

  private noiseHit(t: number, filter: { type: BiquadFilterType; freq: number; q: number }, level: number, attack: number, decay: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    f.Q.value = filter.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
    src.onended = () => g.disconnect();
  }
}
