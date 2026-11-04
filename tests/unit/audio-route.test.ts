import { describe, expect, it } from "vitest";
import { findAudioRoute, isOtherIphoneBrowser, isPhone, type RouteAbilities } from "@/components/calls/audio-route";

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

  it("tells Safari on an iPhone from the iPhone's other browsers", () => {
    const os = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    // Safari, and pages Telegram or WhatsApp open (Safari inside the app).
    expect(isOtherIphoneBrowser(`${os} Version/18.4 Mobile/15E148 Safari/604.1`)).toBe(false);
    // Chrome, Firefox, Edge, Google's app, Facebook, Instagram, and an app's plain web view.
    expect(isOtherIphoneBrowser(`${os} CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1`)).toBe(true);
    expect(isOtherIphoneBrowser(`${os} FxiOS/132.0 Mobile/15E148 Safari/605.1.15`)).toBe(true);
    expect(isOtherIphoneBrowser(`${os} EdgiOS/130.0.2849.80 Version/18.0 Mobile/15E148 Safari/604.1`)).toBe(true);
    expect(isOtherIphoneBrowser(`${os} GSA/340.0.689958014 Mobile/15E148 Safari/604.1`)).toBe(true);
    expect(isOtherIphoneBrowser(`${os} Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.40.107]`)).toBe(true);
    expect(isOtherIphoneBrowser(`${os} Mobile/15E148 Instagram 357.0.0.25.101`)).toBe(true);
    expect(isOtherIphoneBrowser(`${os} Mobile/15E148`)).toBe(true);
    // Not an iPhone at all.
    expect(isOtherIphoneBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36")).toBe(false);
  });
});
