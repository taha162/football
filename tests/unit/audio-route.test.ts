import { describe, expect, it } from "vitest";
import { findAudioRoute, type RouteAbilities } from "@/components/calls/audio-route";

const d = (kind: MediaDeviceKind, label: string, deviceId = label.toLowerCase().replace(/\W+/g, "-")) => ({ kind, label, deviceId });
const iPhone: RouteAbilities = { audioSession: true, noEarpiece: false, setSinkId: false };
const iPad: RouteAbilities = { audioSession: true, noEarpiece: true, setSinkId: false };
const chrome: RouteAbilities = { audioSession: false, noEarpiece: false, setSinkId: true };

describe("loudspeaker or earpiece", () => {
  it("iPhone: switches Safari's audio session (a voice-call session plays on the earpiece)", () => {
    expect(findAudioRoute([d("audioinput", "iPhone Microphone")], iPhone)).toEqual({ kind: "session", speaker: "auto", earpiece: "play-and-record" });
    // Even before the microphone's name is known.
    expect(findAudioRoute([d("audioinput", "", "x")], iPhone)?.kind).toBe("session");
    // An iPad has no earpiece.
    expect(findAudioRoute([d("audioinput", "iPad Microphone")], iPad)).toBeNull();
  });

  it("Android: switches the microphone between Speakerphone and Headset earpiece", () => {
    const devices = [d("audioinput", "Speakerphone", "sp"), d("audioinput", "Headset earpiece", "ear"), d("audiooutput", "", "default")];
    expect(findAudioRoute(devices, chrome)).toEqual({ kind: "input", speaker: "sp", earpiece: "ear" });
  });

  it("elsewhere: points the output at Speaker or Receiver where a browser lists them", () => {
    const devices = [d("audioinput", "Microphone"), d("audiooutput", "Receiver", "rcv"), d("audiooutput", "Speaker", "spk")];
    expect(findAudioRoute(devices, chrome)).toEqual({ kind: "output", speaker: "spk", earpiece: "rcv" });
    expect(findAudioRoute(devices, { ...chrome, setSinkId: false })).toBeNull();
  });

  it("leaves headphones and Bluetooth alone, and offers nothing on a laptop", () => {
    expect(findAudioRoute([d("audioinput", "iPhone Microphone"), d("audioinput", "AirPods Pro")], iPhone)).toBeNull();
    expect(findAudioRoute([d("audioinput", "Speakerphone"), d("audioinput", "Headset earpiece"), d("audioinput", "Bluetooth headset")], chrome)).toBeNull();
    expect(findAudioRoute([d("audiooutput", "Default - Speakers (Realtek)"), d("audiooutput", "Monitor (HDMI)")], chrome)).toBeNull();
    // Labels are empty before the microphone is allowed.
    expect(findAudioRoute([d("audiooutput", "", "a"), d("audiooutput", "", "b")], chrome)).toBeNull();
  });
});
