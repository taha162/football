"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, MapPin, Mic, SendHorizontal, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, Hidden, SubmitButton, useErrorText, type FormAction } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { formatDistance, formatDuration } from "@/lib/duration";
import type { SharedPoint } from "@/lib/geo";
import { sendMessageAction } from "@/server/messages";
import { LocationMap } from "./location-map";

const MAX_SIDE = 1600;
/** Longest voice note, in seconds (the server accepts up to 300). */
export const MAX_RECORDING_SECONDS = 120;

/**
 * Phone photos are often several megabytes: shrink to at most 1600 px on the
 * long side as JPEG before sending (faster on mobile data, and under the 5 MB
 * limit). Falls back to the original file if the browser can't decode it.
 */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/**
 * Recording formats in order of preference. AAC in MP4 plays everywhere
 * (iPhones record it); WebM/Ogg with Opus is what Chrome and Firefox record
 * otherwise, and current iPhones play it too.
 */
const RECORDING_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

export function pickRecordingType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

const extensionOf = (type: string) => (type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm");

type Mode = "text" | "location" | "voice";

/**
 * What the member writes or sends: text with an optional picture, their
 * current location, or a voice note. Location and voice open their own
 * panel in place of the text box, each with its own send and cancel.
 * `onSending` puts a text message in the conversation the moment it is sent
 * (the thread takes it back if sending fails).
 */
export function Composer({ conversationId, onSending }: { conversationId: string; onSending?: (body: string) => void }) {
  const [mode, setMode] = useState<Mode>("text");
  const back = () => setMode("text");
  if (mode === "location") return <LocationPanel conversationId={conversationId} onDone={back} />;
  if (mode === "voice") return <VoiceRecorder conversationId={conversationId} onDone={back} />;
  return <TextComposer conversationId={conversationId} onMode={setMode} onSending={onSending} />;
}

/**
 * Text and/or one picture. The picture is previewed, and can be removed before
 * sending. Text alone leaves the box at once, so the next message can be
 * written while it is on its way; if it can't be sent, it comes back to the
 * box with the reason. A picture waits for its upload, as before.
 */
function TextComposer({ conversationId, onMode, onSending }: { conversationId: string; onMode: (mode: Mode) => void; onSending?: (body: string) => void }) {
  const t = useTranslations("messages");
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Written while a message was on its way. React empties the form once sending
  // ends, whatever the answer: this is put back afterwards.
  const typed = useRef("");
  const [preview, setPreview] = useState<string | null>(null);

  const send: FormAction = async (prev, fd) => {
    const body = String(fd.get("body") ?? "").trim();
    const image = fd.get("image");
    const textOnly = Boolean(onSending) && body !== "" && !(image instanceof File && image.size > 0);
    if (textOnly) {
      onSending!(body);
      if (box.current) box.current.value = "";
    }
    try {
      return await sendMessageAction(prev, fd);
    } catch {
      // No answer at all (the connection dropped): taken back like any refusal, not a broken page.
      return { ok: false, error: "generic", at: Date.now() };
    } finally {
      typed.current = textOnly ? (box.current?.value ?? "") : "";
    }
  };
  /** Puts back what was written while sending, after what the form itself restored (a refused message's text). */
  const keepTyped = () => {
    const draft = typed.current;
    typed.current = "";
    if (!draft || !box.current) return;
    box.current.value = box.current.value ? `${box.current.value}\n${draft}` : draft;
  };

  const clear = () => {
    if (fileInput.current) fileInput.current.value = "";
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  const tool = "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-muted transition-colors hover:text-ink";
  return (
    <ActionForm
      action={send}
      resetOnSuccess
      hideSuccess
      onSuccess={() => {
        clear();
        keepTyped();
      }}
      onError={keepTyped}
      className="gap-2"
    >
      <Hidden values={{ conversation_id: conversationId }} />
      {preview ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
          <img src={preview} alt="" className="max-h-40 rounded-xl border border-line" />
          <button type="button" onClick={clear} aria-label={t("removeImage")} className="absolute -top-2 -end-2 flex size-7 items-center justify-center rounded-full bg-surface-3 text-ink shadow">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
      <label htmlFor="message-body" className="sr-only">{t("write")}</label>
      <Textarea ref={box} id="message-body" name="body" required={!preview} maxLength={2000} placeholder={t("placeholder")} className="min-h-20" dir="auto" />
      {/* Send on the right, the picture/location/voice tools on the left. */}
      <div className="flex items-center justify-between gap-2">
        <SubmitButton>{t("send")}</SubmitButton>
        <div className="flex items-center gap-2">
          <label className={tool} title={t("attach")}>
            <ImagePlus aria-hidden="true" className="size-5" />
            <span className="sr-only">{t("attach")}</span>
            <input
              ref={fileInput}
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp,image/*"
              className="sr-only"
              onChange={async (e) => {
                const input = e.currentTarget;
                const chosen = input.files?.[0];
                if (!chosen) return clear();
                const small = await shrink(chosen);
                if (small !== chosen) {
                  const list = new DataTransfer();
                  list.items.add(small);
                  input.files = list.files;
                }
                setPreview((old) => {
                  if (old) URL.revokeObjectURL(old);
                  return URL.createObjectURL(small);
                });
              }}
            />
          </label>
          <button type="button" className={tool} title={t("shareLocation")} aria-label={t("shareLocation")} onClick={() => onMode("location")}>
            <MapPin aria-hidden="true" className="size-5" />
          </button>
          <button type="button" className={tool} title={t("record")} aria-label={t("record")} onClick={() => onMode("voice")}>
            <Mic aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
    </ActionForm>
  );
}

type Fix = { kind: "locating" } | { kind: "ready"; point: SharedPoint } | { kind: "error"; code: "locationDenied" | "locationFailed" | "locationUnsupported" };

/**
 * Finds the phone's current position with the GPS (high accuracy), shows it
 * on a map with how accurate it is (it sharpens over a few seconds), and sends
 * it only when the member confirms.
 */
function LocationPanel({ conversationId, onDone }: { conversationId: string; onDone: () => void }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const [fix, setFix] = useState<Fix>(() =>
    typeof navigator !== "undefined" && !("geolocation" in navigator) ? { kind: "error", code: "locationUnsupported" } : { kind: "locating" },
  );

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let best: SharedPoint | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        // Keep the sharpest reading.
        if (!best || point.accuracy <= (best.accuracy ?? Infinity)) {
          best = point;
          setFix({ kind: "ready", point });
        }
      },
      (err) => {
        if (!best) setFix({ kind: "error", code: err.code === err.PERMISSION_DENIED ? "locationDenied" : "locationFailed" });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const distance = (m: number) => formatDistance(m, locale, { m: (n) => t("metres", { n }), km: (n) => t("kilometres", { n }) });
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3" data-testid="location-panel">
      {fix.kind === "locating" ? (
        <p role="status" className="flex min-h-12 items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {t("locating")}
        </p>
      ) : null}
      {fix.kind === "ready" ? (
        <>
          <LocationMap lat={fix.point.lat} lng={fix.point.lng} accuracy={fix.point.accuracy} height={168} className="rounded-xl" />
          <p className="text-sm text-ink" role="status">
            {t("locationAccuracy", { distance: distance(fix.point.accuracy ?? 0) })}
            {(fix.point.accuracy ?? 0) > 50 ? <span className="block text-xs text-muted">{t("locationImproving")}</span> : null}
          </p>
          <ActionForm action={sendMessageAction} hideSuccess onSuccess={onDone} className="gap-2">
            <Hidden
              values={{
                conversation_id: conversationId,
                location_lat: fix.point.lat,
                location_lng: fix.point.lng,
                location_accuracy: Math.round(fix.point.accuracy ?? 0),
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton>
                <MapPin aria-hidden="true" className="size-4" />
                {t("sendLocation")}
              </SubmitButton>
              <Button variant="ghost" onClick={onDone}>{t("cancel")}</Button>
            </div>
          </ActionForm>
        </>
      ) : null}
      {fix.kind === "error" ? (
        <>
          <Alert tone="warning">{t(fix.code)}</Alert>
          <Button variant="ghost" className="self-start" onClick={onDone}>{t("cancel")}</Button>
        </>
      ) : fix.kind === "locating" ? (
        <Button variant="ghost" className="self-start" onClick={onDone}>{t("cancel")}</Button>
      ) : null}
    </div>
  );
}

type Recording = "starting" | "recording" | "stopped" | "sending";

/**
 * Records a voice note: starts at once, shows the time and a dot that moves
 * with the voice, and sends on one tap (or deletes). Stops by itself at two
 * minutes, then waits for send or delete.
 */
function VoiceRecorder({ conversationId, onDone }: { conversationId: string; onDone: () => void }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const errorText = useErrorText();
  const [phase, setPhase] = useState<Recording>("starting");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const live = useRef<{ stream: MediaStream | null; recorder: MediaRecorder | null; chunks: Blob[]; started: number; seconds: number; audio: AudioContext | null; frame: number }>({
    stream: null,
    recorder: null,
    chunks: [],
    started: 0,
    seconds: 0,
    audio: null,
    frame: 0,
  });

  const release = () => {
    const r = live.current;
    cancelAnimationFrame(r.frame);
    r.stream?.getTracks().forEach((track) => track.stop());
    r.stream = null;
    void r.audio?.close().catch(() => undefined);
    r.audio = null;
  };

  useEffect(() => {
    let cancelled = false;
    const r = live.current;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setError(t("recordUnsupported"));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        r.stream = stream;
        const type = pickRecordingType();
        const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 48_000 });
        r.chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size) r.chunks.push(e.data);
        };
        recorder.start(1000);
        r.recorder = recorder;
        r.started = performance.now();
        setPhase("recording");
        // The level meter: how loud the microphone hears the member.
        try {
          const audio = new AudioContext();
          const analyser = audio.createAnalyser();
          analyser.fftSize = 256;
          audio.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
            dot.current?.style.setProperty("--level", String(Math.min(1, peak / 64)));
            r.frame = requestAnimationFrame(tick);
          };
          r.audio = audio;
          tick();
        } catch {
          // The meter is decoration; recording works without it.
        }
      } catch (e) {
        setError((e as Error).name === "NotAllowedError" || (e as Error).name === "SecurityError" ? t("micDenied") : t("recordFailed"));
      }
    })();
    return () => {
      cancelled = true;
      if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts once, when the panel opens
  }, []);

  /** Stops the recorder and resolves once its last piece of audio has arrived. */
  const finishRecording = () =>
    new Promise<void>((resolve) => {
      const r = live.current;
      r.seconds = Math.min(MAX_RECORDING_SECONDS, (performance.now() - r.started) / 1000);
      const recorder = r.recorder;
      if (!recorder || recorder.state === "inactive") return resolve();
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });

  const stop = async (andSend: boolean) => {
    if (live.current.recorder?.state === "recording") {
      await finishRecording();
      release();
      setElapsed(live.current.seconds);
    }
    if (andSend) await send();
    else setPhase("stopped");
  };

  const send = async () => {
    const r = live.current;
    const type = r.recorder?.mimeType || r.chunks[0]?.type || "audio/webm";
    const blob = new Blob(r.chunks, { type });
    if (!blob.size) return setError(t("recordFailed"));
    const fd = new FormData();
    fd.set("conversation_id", conversationId);
    fd.set("voice", new File([blob], `voice.${extensionOf(type)}`, { type: type.split(";")[0] }));
    fd.set("voice_seconds", String(Math.max(1, Math.round(r.seconds))));
    setPhase("sending");
    setError(null);
    const result = await sendMessageAction(null, fd);
    if (result?.ok) onDone();
    else {
      setError(errorText.error(result?.error ?? "generic"));
      setPhase("stopped");
    }
  };

  const discard = () => {
    const r = live.current;
    if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop();
    release();
    onDone();
  };

  // The clock, and the stop at the limit.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const s = (performance.now() - live.current.started) / 1000;
      setElapsed(s);
      if (s >= MAX_RECORDING_SECONDS) {
        clearInterval(id);
        void stop(false);
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop only reads refs
  }, [phase]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3" data-testid="voice-recorder">
      {error ? <Alert tone="warning">{error}</Alert> : null}
      {/* As in the text box: send on the right, delete on the left. */}
      <div className="flex items-center justify-between gap-3">
        <Button onClick={() => void stop(true)} disabled={phase === "starting" || phase === "sending" || Boolean(error && phase !== "stopped")} aria-label={t("sendVoice")} className="size-11 px-0">
          {phase === "sending" ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <SendHorizontal aria-hidden="true" className="size-5 rtl:-scale-x-100" />}
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3" role="status" aria-live="polite">
          {phase === "starting" && !error ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-muted" /> : null}
          {phase === "recording" ? <span ref={dot} aria-hidden="true" className="rec-dot size-3 rounded-full bg-danger" /> : null}
          <span className="num font-display text-lg font-bold text-ink">{formatDuration(elapsed, locale)}</span>
          <span className="text-sm text-muted">{phase === "recording" ? t("recording") : phase === "sending" ? t("sendingVoice") : null}</span>
        </div>
        <Button variant="ghost" onClick={discard} aria-label={t("discardRecording")} disabled={phase === "sending"} className="size-11 px-0">
          <Trash2 aria-hidden="true" className="size-5" />
        </Button>
      </div>
      {phase === "stopped" && elapsed >= MAX_RECORDING_SECONDS - 0.5 ? <p className="text-center text-xs text-muted">{t("recordLimit")}</p> : null}
    </div>
  );
}
