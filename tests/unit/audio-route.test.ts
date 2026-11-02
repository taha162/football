import { describe, expect, it } from "vitest";
import { findAudioRoute } from "@/components/calls/audio-route";

const d = (kind: MediaDeviceKind, label: string, deviceId = label.toLowerCase().replace(/\W+/g, "-")) => ({ kind, label, deviceId });

describe("loudspeaker or earpiece", () => {
  it("iPhone: switches the call's output between Speaker and Receiver", () => {
    const devices = [d("audioinput", "iPhone Microphone"), d("audiooutput", "Receiver", "rcv"), d("audiooutput", "Speaker", "spk")];
    expect(findAudioRoute(devices, true)).toEqual({ kind: "output", speaker: "spk", earpiece: "rcv" });
    // A browser that can't point the output anywhere offers no switch.
    expect(findAudioRoute(devices, false)).toBeNull();
  });

  it("Android: switches the microphone between Speakerphone and Headset earpiece", () => {
    const devices = [d("audioinput", "Speakerphone", "sp"), d("audioinput", "Headset earpiece", "ear"), d("audiooutput", "", "default")];
    expect(findAudioRoute(devices, true)).toEqual({ kind: "input", speaker: "sp", earpiece: "ear" });
  });

  it("leaves headphones and Bluetooth alone, and offers nothing on a laptop", () => {
    expect(findAudioRoute([d("audiooutput", "Receiver"), d("audiooutput", "Speaker"), d("audiooutput", "AirPods Pro")], true)).toBeNull();
    expect(findAudioRoute([d("audioinput", "Speakerphone"), d("audioinput", "Headset earpiece"), d("audioinput", "Bluetooth headset")], true)).toBeNull();
    expect(findAudioRoute([d("audiooutput", "Default - Speakers (Realtek)"), d("audiooutput", "Monitor (HDMI)")], true)).toBeNull();
    // Labels are empty before the microphone is allowed.
    expect(findAudioRoute([d("audiooutput", "", "a"), d("audiooutput", "", "b")], true)).toBeNull();
  });
});
