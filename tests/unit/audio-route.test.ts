import { describe, expect, it } from "vitest";
import { findAudioRoute, isPhone, type RouteAbilities } from "@/components/calls/audio-route";

const d = (kind: MediaDeviceKind, label: string, deviceId = label.toLowerCase().replace(/\W+/g, "-")) => ({ kind, label, deviceId });
const safari: RouteAbilities = { setSinkId: true };
const noSink: RouteAbilities = { setSinkId: false };

describe("loudspeaker or earpiece", () => {
  it("iPhone (Safari 18.4+): points the call's output at Speaker or Receiver", () => {
    const devices = [d("audioinput", "iPhone Microphone"), d("audiooutput", "Speaker", "spk"), d("audiooutput", "Receiver", "rcv")];
    expect(findAudioRoute(devices, safari)).toEqual({ kind: "output", speaker: "spk", earpiece: "rcv" });
    // Arabic labels too.
    expect(findAudioRoute([d("audiooutput", "مكبر الصوت", "spk"), d("audiooutput", "سماعة الأذن", "rcv")], safari)).toEqual({
      kind: "output",
      speaker: "spk",
      earpiece: "rcv",
    });
    // A language not listed: of the two outputs, the one recognised tells the other apart.
    expect(findAudioRoute([d("audiooutput", "Speaker", "spk"), d("audiooutput", "Hörmuschel", "rcv")], safari)).toEqual({
      kind: "output",
      speaker: "spk",
      earpiece: "rcv",
    });
  });

  it("iPhone before 18.4 lists no outputs: no route, so the button says so", () => {
    expect(findAudioRoute([d("audioinput", "iPhone Microphone")], safari)).toBe("unsupported");
    expect(findAudioRoute([d("audioinput", "", "x")], noSink)).toBe("unsupported");
    // Outputs, but no way to choose one.
    expect(findAudioRoute([d("audiooutput", "Speaker", "spk"), d("audiooutput", "Receiver", "rcv")], noSink)).toBe("unsupported");
  });

  it("Android: switches the microphone between Speakerphone and Headset earpiece", () => {
    const devices = [d("audioinput", "Speakerphone", "sp"), d("audioinput", "Headset earpiece", "ear"), d("audiooutput", "", "default")];
    expect(findAudioRoute(devices, safari)).toEqual({ kind: "input", speaker: "sp", earpiece: "ear" });
  });

  it("leaves headphones and Bluetooth alone, and offers nothing on a laptop", () => {
    expect(findAudioRoute([d("audioinput", "iPhone Microphone"), d("audiooutput", "AirPods Pro"), d("audiooutput", "Receiver")], safari)).toBe("headset");
    expect(findAudioRoute([d("audioinput", "Speakerphone"), d("audioinput", "Headset earpiece"), d("audioinput", "Bluetooth headset")], safari)).toBe("headset");
    expect(findAudioRoute([d("audioinput", "Speakerphone"), d("audioinput", "Headset earpiece"), d("audioinput", "USB audio")], safari)).toBe("headset");
    expect(findAudioRoute([d("audiooutput", "Default - Speakers (Realtek)"), d("audiooutput", "Monitor (HDMI)")], safari)).toBe("unsupported");
    // Labels are empty before the microphone is allowed.
    expect(findAudioRoute([d("audiooutput", "", "a"), d("audiooutput", "", "b")], safari)).toBe("unsupported");
  });

  it("only phones get the button: not tablets, not computers", () => {
    const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    const androidTablet = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const iPad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15";
    expect(isPhone(iPhone, true)).toBe(true);
    expect(isPhone(android, true)).toBe(true);
    expect(isPhone(androidTablet, true)).toBe(false);
    expect(isPhone(iPad, true)).toBe(false);
    expect(isPhone(android, false)).toBe(false);
  });
});
