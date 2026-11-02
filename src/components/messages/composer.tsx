"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, MapPin, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { formatDistance } from "@/lib/duration";
import type { SharedPoint } from "@/lib/geo";
import { sendMessageAction } from "@/server/messages";
import { LocationMap } from "./location-map";

const MAX_SIDE = 1600;

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

type Mode = "text" | "location";

/**
 * What the member writes or sends: text with an optional picture, or their
 * current location. Location opens its own panel in place of the text box,
 * with its own send and cancel.
 */
export function Composer({ conversationId }: { conversationId: string }) {
  const [mode, setMode] = useState<Mode>("text");
  const back = () => setMode("text");
  if (mode === "location") return <LocationPanel conversationId={conversationId} onDone={back} />;
  return <TextComposer conversationId={conversationId} onMode={setMode} />;
}

/** Text and/or one picture. The picture is previewed, and can be removed before sending. */
function TextComposer({ conversationId, onMode }: { conversationId: string; onMode: (mode: Mode) => void }) {
  const t = useTranslations("messages");
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const clear = () => {
    if (fileInput.current) fileInput.current.value = "";
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  const tool = "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-muted transition-colors hover:text-ink";
  return (
    <ActionForm action={sendMessageAction} resetOnSuccess hideSuccess onSuccess={clear} className="gap-2">
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
      <Textarea id="message-body" name="body" required={!preview} maxLength={2000} placeholder={t("placeholder")} className="min-h-20" dir="auto" />
      <div className="flex items-center justify-between gap-2">
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
        </div>
        <SubmitButton>{t("send")}</SubmitButton>
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
