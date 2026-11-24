"use client";

import { useEffect, useRef, useState } from "react";
import { Film, ImagePlus, Loader2, MapPin, Mic, Play, SendHorizontal, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, Hidden, SubmitButton, useErrorText, type FormAction } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatDistance, formatDuration } from "@/lib/duration";
import type { SharedPoint } from "@/lib/geo";
import { THUMB_MAX_SIDE } from "@/lib/message-thumb";
import { MAX_VIDEO_BYTES, videoTypeOf, type VideoType } from "@/lib/message-video";
import { makeThumbnail, shrinkImage } from "@/lib/shrink-image";
import { sendMessageAction, sendVideoMessageAction, startVideoUpload } from "@/server/messages";
import { LocationMap } from "./location-map";
import { readVideo, uploadVideo } from "./video-attachment";

/** Longest voice note, in seconds (the server accepts up to 300). */
export const MAX_RECORDING_SECONDS = 120;

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

/** A video chosen to send, with what the browser could read from it. */
type ChosenVideo = { file: File; type: VideoType; seconds: number | null; still: File | null; stillUrl: string | null };

/**
 * What the member writes or sends: text with an optional picture, their
 * current location, or a voice note. Location and voice open their own
 * panel in place of the text box, each with its own send and cancel.
 * `onSending` puts a text message in the conversation the moment it is sent
 * (the thread takes it back if sending fails).
 */
export function Composer({
  conversationId,
  onSending,
  onTyping,
}: {
  conversationId: string;
  onSending?: (body: string) => void;
  /** Called as text is typed: the thread tells the others (at most every few seconds). */
  onTyping?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("text");
  const back = () => setMode("text");
  if (mode === "location") return <LocationPanel conversationId={conversationId} onDone={back} />;
  if (mode === "voice") return <VoiceRecorder conversationId={conversationId} onDone={back} />;
  return <TextComposer conversationId={conversationId} onMode={setMode} onSending={onSending} onTyping={onTyping} />;
}

/**
 * Text and/or one picture or video. Either is previewed, and can be removed
 * before sending. Text alone leaves the box at once, so the next message can
 * be written while it is on its way; if it can't be sent, it comes back to
 * the box with the reason. A picture waits for its upload, as before. A video
 * goes straight to storage (it is too big for the site's server), with a
 * progress bar; removing it cancels the upload.
 */
function TextComposer({
  conversationId,
  onMode,
  onSending,
  onTyping,
}: {
  conversationId: string;
  onMode: (mode: Mode) => void;
  onSending?: (body: string) => void;
  onTyping?: () => void;
}) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const errorText = useErrorText();
  const fileInput = useRef<HTMLInputElement>(null);
  // The picture's small copy, sent alongside it (lib/message-thumb.ts).
  const thumbInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Written since a text message left the box. React empties the form once
  // sending ends, whatever the answer, and the form clears itself again just
  // after: this is put back then. Kept up to date on every keystroke (not read
  // once when the answer comes), so nothing typed in between is lost.
  const typed = useRef("");
  const sending = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  // A chosen video (and the same, for the send action to read), its upload's progress, and why it can't go.
  const [video, setVideo] = useState<ChosenVideo | null>(null);
  const chosenVideo = useRef<ChosenVideo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useRef<XMLHttpRequest | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const pickVideo = (next: ChosenVideo | null) => {
    chosenVideo.current = next;
    setVideo((old) => {
      if (old?.stillUrl && old.stillUrl !== next?.stillUrl) URL.revokeObjectURL(old.stillUrl);
      return next;
    });
  };
  // While text is being written, location and voice step aside: the box gets their room (small phones).
  const [hasText, setHasText] = useState(false);
  /** The box grows with what is written, up to six lines, then scrolls. */
  const fit = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the border; without it the last line would scroll by a pixel or two.
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 152)}px`;
    setHasText(Boolean(el.value.trim()));
  };

  /** A video: a one-time upload link, the file straight to storage, then the message (with the still). */
  const sendVideo = async (prev: Parameters<FormAction>[0], chosen: ChosenVideo, body: string): ReturnType<FormAction> => {
    setVideoError(null);
    const start = await startVideoUpload(conversationId, { type: chosen.type, size: chosen.file.size }).catch(() => null);
    if (!start?.ok) return { ok: false, error: start?.error ?? "request_failed", at: Date.now() };
    setProgress(0);
    try {
      await uploadVideo(start.url, chosen.file, chosen.type, setProgress, upload);
    } catch (e) {
      setProgress(null);
      const code = (e as Error).message;
      return { ok: false, error: code === "cancelled" ? "upload_cancelled" : code, at: Date.now() };
    }
    const out = new FormData();
    out.set("conversation_id", conversationId);
    out.set("video_path", start.path);
    out.set("body", body);
    if (chosen.seconds) out.set("video_seconds", String(chosen.seconds));
    if (chosen.still) out.set("poster", chosen.still);
    try {
      return await sendVideoMessageAction(prev, out);
    } catch {
      return { ok: false, error: "request_failed", at: Date.now() };
    } finally {
      setProgress(null);
    }
  };

  const send: FormAction = async (prev, fd) => {
    const body = String(fd.get("body") ?? "").trim();
    const image = fd.get("image");
    const chosen = chosenVideo.current;
    if (chosen) return sendVideo(prev, chosen, body);
    const textOnly = Boolean(onSending) && body !== "" && !(image instanceof File && image.size > 0);
    if (textOnly) {
      onSending!(body);
      if (box.current) box.current.value = "";
      fit();
      typed.current = "";
      sending.current = true;
    }
    try {
      return await sendMessageAction(prev, fd);
    } catch {
      // No answer at all (the connection dropped): taken back like any refusal, not a broken page.
      return { ok: false, error: "generic", at: Date.now() };
    }
  };
  /** Puts back what was written while sending, after what the form itself restored (a refused message's text). */
  const keepTyped = () => {
    const draft = typed.current;
    typed.current = "";
    sending.current = false;
    if (!draft || !box.current) return;
    const restored = box.current.value;
    box.current.value = restored && restored !== draft ? `${restored}\n${draft}` : draft;
    fit();
  };

  const clear = () => {
    if (fileInput.current) fileInput.current.value = "";
    if (thumbInput.current) thumbInput.current.value = "";
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    // A video on its way stops here.
    upload.current?.abort();
    pickVideo(null);
    setProgress(null);
    setVideoError(null);
  };

  /** A chosen video: checked, previewed with a still and its length (read in the browser), not sent with the form. */
  const chooseVideo = async (file: File) => {
    if (fileInput.current) fileInput.current.value = "";
    if (thumbInput.current) thumbInput.current.value = "";
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    const type = videoTypeOf(file);
    if (!type) {
      pickVideo(null);
      return setVideoError(errorText.error("video_type_not_allowed"));
    }
    if (file.size > MAX_VIDEO_BYTES) {
      pickVideo(null);
      return setVideoError(errorText.error("video_too_large"));
    }
    setVideoError(null);
    const first: ChosenVideo = { file, type, seconds: null, still: null, stillUrl: null };
    pickVideo(first);
    const { seconds, still } = await readVideo(file);
    // Removed, or another chosen, meanwhile.
    if (chosenVideo.current?.file !== file) return;
    pickVideo({ ...first, seconds, still, stillUrl: still ? URL.createObjectURL(still) : null });
  };

  // Round, 44 px; 40 px on the narrowest phones (under 360 px), so the box keeps room to write.
  const round = "size-10 shrink-0 rounded-full min-[360px]:size-11";
  const tool = cn(round, "flex cursor-pointer items-center justify-center border border-line bg-surface-2 text-muted transition-colors hover:text-ink");
  return (
    <ActionForm
      action={send}
      resetOnSuccess
      hideSuccess
      onSuccess={() => {
        clear();
        keepTyped();
        fit();
      }}
      onError={() => {
        keepTyped();
        fit();
      }}
      className="gap-2"
    >
      <Hidden values={{ conversation_id: conversationId }} />
      {video ? (
        <div className="flex flex-col gap-2">
          <div className="relative w-fit">
            <div className="relative grid h-40 min-w-32 place-items-center overflow-hidden rounded-xl border border-line bg-surface-3">
              {video.stillUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local still of the chosen video
                <img src={video.stillUrl} alt="" className="h-40 w-auto max-w-[min(18rem,70vw)] object-cover" />
              ) : (
                <Film aria-hidden="true" className="size-8 text-muted" />
              )}
              <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                <span className="grid size-10 place-items-center rounded-full bg-black/55 text-white">
                  <Play className="size-5 translate-x-px" />
                </span>
              </span>
              {video.seconds ? (
                <span className="num absolute bottom-1.5 start-1.5 rounded bg-black/60 px-1.5 text-[11px] font-medium text-white">{formatDuration(video.seconds, locale)}</span>
              ) : null}
            </div>
            <button type="button" onClick={clear} aria-label={t("removeVideo")} className="absolute -top-2 -end-2 flex size-7 items-center justify-center rounded-full bg-surface-3 text-ink shadow">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          {progress !== null ? (
            <div className="flex items-center gap-2">
              <div
                role="progressbar"
                aria-label={t("uploadingVideo")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-3"
              >
                <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="num text-xs text-muted">{t("uploadPercent", { percent: Math.round(progress * 100) })}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {videoError ? (
        <Alert tone="warning" className="alert-pop">
          {videoError}
        </Alert>
      ) : null}
      {preview ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
          <img src={preview} alt="" className="max-h-40 rounded-xl border border-line" />
          <button type="button" onClick={clear} aria-label={t("removeImage")} className="absolute -top-2 -end-2 flex size-7 items-center justify-center rounded-full bg-surface-3 text-ink shadow">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
      {/* One row: send on the right, then the box (the picture button inside its left end), location and voice on the left. */}
      <div className="flex items-end gap-1 min-[360px]:gap-1.5">
        <SubmitButton aria-label={t("send")} title={t("send")} pendingLabel={<span className="sr-only">{t("send")}</span>} className={cn(round, "p-0")}>
          <SendHorizontal aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        </SubmitButton>
        <div className="relative min-w-0 flex-1">
          <label htmlFor="message-body" className="sr-only">{t("write")}</label>
          <Textarea
            ref={box}
            id="message-body"
            name="body"
            rows={1}
            required={!preview && !video}
            maxLength={2000}
            placeholder={t("placeholder")}
            // 16px: phones don't zoom into the box when it takes the focus. The box keeps the page's direction, so
            // the room for the picture button stays on its left; each line of text finds its own (plaintext).
            className="block max-h-[152px] min-h-10 resize-none rounded-[22px] py-[7px] pe-11 text-base leading-6 [unicode-bidi:plaintext] min-[360px]:min-h-11 min-[360px]:py-[9px]"
            onInput={(e) => {
              if (sending.current) typed.current = e.currentTarget.value;
              if (e.currentTarget.value.trim()) onTyping?.();
              fit();
            }}
            onKeyDown={(e) => {
              // A computer (a mouse or trackpad): Enter sends, Shift+Enter starts a new line. Phones keep Enter for new lines.
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              if (!window.matchMedia("(pointer: fine)").matches) return;
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }}
          />
          <label className={cn(round, "absolute bottom-0 end-0 flex cursor-pointer items-center justify-center text-muted transition-colors hover:text-ink")} title={t("attach")}>
            <ImagePlus aria-hidden="true" className="size-5" />
            <span className="sr-only">{t("attach")}</span>
            <input
              ref={fileInput}
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp,image/*,video/mp4,video/quicktime,video/webm,video/*"
              className="sr-only"
              onChange={async (e) => {
                const input = e.currentTarget;
                const chosen = input.files?.[0];
                if (!chosen) return clear();
                // A video goes its own way (straight to storage on send), not with the form.
                if (chosen.type.startsWith("video/") || videoTypeOf(chosen)) return chooseVideo(chosen);
                pickVideo(null);
                setVideoError(null);
                // Phone photos: at most 1600 px as JPEG before sending (src/lib/shrink-image.ts), and previewed as sent.
                const small = await shrinkImage(chosen);
                if (small !== chosen) {
                  const list = new DataTransfer();
                  list.items.add(small);
                  input.files = list.files;
                }
                // And a small copy for the conversation to show (it opens the picture itself).
                const thumb = await makeThumbnail(small, THUMB_MAX_SIDE);
                if (thumbInput.current) {
                  const list = new DataTransfer();
                  if (thumb) list.items.add(thumb);
                  thumbInput.current.files = list.files;
                }
                setPreview((old) => {
                  if (old) URL.revokeObjectURL(old);
                  return URL.createObjectURL(small);
                });
              }}
            />
          </label>
          <input ref={thumbInput} type="file" name="image_thumb" accept="image/jpeg" className="hidden" tabIndex={-1} aria-hidden="true" />
        </div>
        <div className={hasText ? "hidden" : "flex shrink-0 items-end gap-1 min-[360px]:gap-1.5"}>
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
