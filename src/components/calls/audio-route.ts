/**
 * Loudspeaker or earpiece during a call, where the browser lets a page choose:
 *
 * - iPhone (Safari 18.4 and later): once the microphone is on, Safari lists
 *   the phone's outputs, "Speaker" and "Receiver" (the earpiece). The call's
 *   <audio> element is pointed at one with setSinkId, which Safari allows only
 *   straight after a tap. Safari plays a call on the loudspeaker unless the
 *   page picks the receiver. (navigator.audioSession can't move the sound;
 *   "play-and-record" only keeps the call's audio session steady.)
 * - Android (Chrome): it lists no outputs, but its microphones include
 *   "Speakerphone" and "Headset earpiece", and the sound follows the
 *   microphone the call uses. Calls start on the loudspeaker.
 * - Any other browser that lists "Speaker" and "Receiver" outputs: as on iPhone.
 *
 * With headphones or Bluetooth connected the sound stays there. Where none of
 * this is offered (an iPhone before 18.4, some in-app browsers) the page can't
 * move the sound, and the call screen says so when its button is pressed.
 */
export interface AudioRoute {
  /** "input": switch the microphone (Android); "output": the <audio> element's output (iPhone). */
  kind: "input" | "output";
  speaker: string;
  earpiece: string;
}

/** Why there's no choice: headphones are connected, or the browser offers none. */
export type NoRoute = "headset" | "unsupported";

export interface RouteAbilities {
  /** HTMLMediaElement.prototype.setSinkId. */
  setSinkId: boolean;
}

type Device = Pick<MediaDeviceInfo, "kind" | "label" | "deviceId">;

const HEADSET = /head(set|phone)|bluetooth|airpods|wired|hands-?free|usb|سماعات|سماعة (ال)?رأس|بلوتوث/i;
const SPEAKER = /speaker|مكبر|haut-parleur|altavoz|lautsprecher|alto-falante/i;
const EARPIECE = /receiver|earpiece|handset|iphone|سماعة|المستقبل|écouteur|auricular|hörer/i;
/** A phone's own loudspeaker or earpiece, named on its own (a computer's outputs carry makes and ports). */
const BUILT_IN = /^(speaker|receiver|iphone|مكبر الصوت|سماعة الأذن|haut-parleur|écouteur|altavoz|auricular|lautsprecher|hörer|alto-falante)$/i;

export function findAudioRoute(devices: Device[], can: RouteAbilities): AudioRoute | NoRoute {
  const audio = devices.filter((d) => (d.kind === "audiooutput" || d.kind === "audioinput") && d.deviceId);
  // Headphones are the person's choice: leave the sound there.
  if (audio.some((d) => HEADSET.test(d.label) && !/earpiece/i.test(d.label))) return "headset";

  // Android: the sound follows the microphone.
  const inputs = audio.filter((d) => d.kind === "audioinput");
  const speakerphone = inputs.find((d) => /speakerphone/i.test(d.label));
  const earpieceMic = inputs.find((d) => /earpiece/i.test(d.label) && !/speaker/i.test(d.label));
  if (speakerphone && earpieceMic) return { kind: "input", speaker: speakerphone.deviceId, earpiece: earpieceMic.deviceId };

  // iPhone, and any browser listing the phone's two outputs.
  if (can.setSinkId) {
    const outputs = audio.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.label);
    let speaker = outputs.find((d) => SPEAKER.test(d.label));
    let earpiece = outputs.find((d) => d !== speaker && EARPIECE.test(d.label) && !SPEAKER.test(d.label));
    // Labels in a language not listed above: of a phone's two built-in outputs, one is recognised, so the other is the other one.
    if (outputs.length === 2 && outputs.some((d) => BUILT_IN.test(d.label.trim()))) {
      if (speaker && !earpiece) earpiece = outputs.find((d) => d !== speaker);
      else if (earpiece && !speaker) speaker = outputs.find((d) => d !== earpiece);
    }
    if (speaker && earpiece) return { kind: "output", speaker: speaker.deviceId, earpiece: earpiece.deviceId };
  }
  return "unsupported";
}

/**
 * An iPhone browser other than Safari: Chrome, Firefox, Edge, or an app's
 * built-in browser (Facebook, Instagram…). Safari says "Version/… Safari/";
 * the others name themselves or leave the version out. Telegram's and
 * WhatsApp's in-app pages are Safari itself.
 */
export function isOtherIphoneBrowser(userAgent: string): boolean {
  if (!/iPhone|iPod/.test(userAgent)) return false;
  const safari = /Version\/\d/.test(userAgent) && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram/.test(userAgent);
  return !safari;
}

/** A phone (not a tablet or a computer): the only place a call has an earpiece to switch to. */
export function isPhone(userAgent: string, coarsePointer: boolean): boolean {
  return coarsePointer && (/iPhone|iPod/.test(userAgent) || (/Android/.test(userAgent) && /Mobile/.test(userAgent)));
}
