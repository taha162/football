/**
 * Loudspeaker or earpiece during a call, where the browser lets a page choose:
 *
 * - iPhone (Safari 16.4+): the Audio Session API. While the microphone is on,
 *   Safari plays a call on the loudspeaker ("auto"); a voice-call session
 *   ("play-and-record") plays it on the earpiece.
 * - Android (Chrome): no outputs to choose, but its microphones include
 *   "Speakerphone" and "Headset earpiece", and the sound follows the
 *   microphone the call uses. Android opens one microphone at a time, so the
 *   current one is closed before the other opens.
 * - Elsewhere, browsers that list the phone's outputs ("Receiver",
 *   "Speaker") point the call's <audio> element at one with setSinkId.
 *
 * With headphones or Bluetooth connected the sound stays where the phone
 * sends it, an iPad has no earpiece, and other browsers offer no choice: then
 * there is no route and the call shows no speaker button.
 */
export interface AudioRoute {
  /** "session": iPhone's audio session type; "input": the microphone (Android); "output": the <audio> element's output. */
  kind: "session" | "input" | "output";
  speaker: string;
  earpiece: string;
}

export interface RouteAbilities {
  /** navigator.audioSession (Safari 16.4+). */
  audioSession: boolean;
  /** iPads (and Macs) have no earpiece. */
  noEarpiece: boolean;
  /** HTMLMediaElement.prototype.setSinkId. */
  setSinkId: boolean;
}

type Device = Pick<MediaDeviceInfo, "kind" | "label" | "deviceId">;

const HEADSET = /head(set|phone)|bluetooth|airpods|wired|hands-?free|سماعات|بلوتوث/i;
const SPEAKER = /speaker|مكبر/i;
const EARPIECE = /receiver|earpiece|handset|iphone|السماعة|المستقبل|سماعة الأذن/i;

export const SESSION_SPEAKER = "auto";
export const SESSION_EARPIECE = "play-and-record";

export function findAudioRoute(devices: Device[], can: RouteAbilities): AudioRoute | null {
  const audio = devices.filter((d) => (d.kind === "audiooutput" || d.kind === "audioinput") && d.deviceId);
  // Headphones are the person's choice: leave the sound there.
  if (audio.some((d) => HEADSET.test(d.label) && !/earpiece/i.test(d.label))) return null;

  if (can.audioSession && !can.noEarpiece) return { kind: "session", speaker: SESSION_SPEAKER, earpiece: SESSION_EARPIECE };

  const inputs = audio.filter((d) => d.kind === "audioinput");
  const speakerphone = inputs.find((d) => /speakerphone/i.test(d.label));
  const headsetEarpiece = inputs.find((d) => /earpiece/i.test(d.label) && !/speaker/i.test(d.label));
  if (speakerphone && headsetEarpiece) return { kind: "input", speaker: speakerphone.deviceId, earpiece: headsetEarpiece.deviceId };

  if (can.setSinkId) {
    const outputs = audio.filter((d) => d.kind === "audiooutput");
    const speaker = outputs.find((d) => SPEAKER.test(d.label));
    const earpiece = outputs.find((d) => d !== speaker && EARPIECE.test(d.label) && !SPEAKER.test(d.label));
    if (speaker && earpiece) return { kind: "output", speaker: speaker.deviceId, earpiece: earpiece.deviceId };
  }
  return null;
}
