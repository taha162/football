/**
 * Loudspeaker or earpiece during a call, where the browser lets a page choose:
 *
 * - iPhone (Safari 18.4+) lists the phone's outputs, "Receiver" (the
 *   earpiece) and "Speaker", once the microphone is on; the call's <audio>
 *   element is pointed at one with setSinkId (only right after a tap).
 * - Android (Chrome) lists no outputs, but its microphones include
 *   "Speakerphone" and "Headset earpiece": the microphone a call uses also
 *   decides where its sound plays.
 *
 * With headphones or Bluetooth connected the sound stays where the phone
 * sends it, and other browsers offer no choice: then there is no route and
 * the call shows no speaker button.
 */
export interface AudioRoute {
  /** "output": switch the <audio> element's output; "input": switch the microphone. */
  kind: "output" | "input";
  speaker: string;
  earpiece: string;
}

type Device = Pick<MediaDeviceInfo, "kind" | "label" | "deviceId">;

const HEADSET = /head(set|phone)|bluetooth|airpods|wired|hands-?free|سماعات|بلوتوث/i;
const SPEAKER = /speaker|مكبر/i;
const EARPIECE = /receiver|earpiece|handset|iphone|السماعة|المستقبل|سماعة الأذن/i;

export function findAudioRoute(devices: Device[], canSetOutput: boolean): AudioRoute | null {
  const audio = devices.filter((d) => (d.kind === "audiooutput" || d.kind === "audioinput") && d.deviceId);
  // Headphones are the person's choice: leave the sound there.
  if (audio.some((d) => HEADSET.test(d.label) && !/earpiece/i.test(d.label))) return null;

  if (canSetOutput) {
    const outputs = audio.filter((d) => d.kind === "audiooutput");
    const speaker = outputs.find((d) => SPEAKER.test(d.label));
    const earpiece = outputs.find((d) => d !== speaker && EARPIECE.test(d.label) && !SPEAKER.test(d.label));
    if (speaker && earpiece) return { kind: "output", speaker: speaker.deviceId, earpiece: earpiece.deviceId };
  }

  const inputs = audio.filter((d) => d.kind === "audioinput");
  const speaker = inputs.find((d) => /speakerphone/i.test(d.label));
  const earpiece = inputs.find((d) => /earpiece/i.test(d.label) && !/speaker/i.test(d.label));
  if (speaker && earpiece) return { kind: "input", speaker: speaker.deviceId, earpiece: earpiece.deviceId };
  return null;
}
