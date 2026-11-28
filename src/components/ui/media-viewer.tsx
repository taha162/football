"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { inApp } from "@/lib/app-shell";
import { cn } from "@/lib/cn";

export type ViewedMedia = {
  kind: "image" | "video";
  src: string;
  alt: string;
  /** A file name for «حفظ»; without it there is no save button (profile pictures). */
  saveAs?: string | null;
};

/**
 * A picture (or video) opened inside the site, over the page, instead of in a
 * new tab: dark backdrop, close, and «حفظ» when the media may be saved. A tap on
 * a picture zooms it to its full size (then scrolls); a tap beside it, Escape,
 * or the phone's back button closes it.
 *
 * Saving downloads the file without leaving the page. On a phone that can
 * share files, it opens the share sheet instead, where «حفظ الصورة» puts it in
 * the photo library.
 */
export function MediaViewer({ media, onClose }: { media: ViewedMedia | null; onClose: () => void }) {
  const t = useTranslations("media");
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  // Whether opening added a history entry, which the back button then removes.
  const pushed = useRef(false);

  const close = useCallback(() => {
    if (pushed.current && window.history.state?.mediaViewer) {
      // The back button's job: popstate (below) does the closing.
      window.history.back();
      return;
    }
    pushed.current = false;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (media && !d.open) {
      setZoomed(false);
      setError(false);
      d.showModal();
      window.history.pushState({ mediaViewer: true }, "");
      pushed.current = true;
    } else if (!media && d.open) {
      d.close();
    }
  }, [media]);

  useEffect(() => {
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onClose]);

  const save = async () => {
    if (!media?.saveAs) return;
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(media.src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], media.saveAs, { type: blob.type || undefined });
      // Phones: the share sheet, which saves to the photo library.
      if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (e) {
          // Closing the share sheet isn't a failure; anything else falls back to a download.
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
      }
      // The phone app's WebView can't download a file: the picture opens in the phone's browser
      // instead (another site always opens outside the app), where pressing it saves it.
      if (inApp()) {
        window.location.href = media.src;
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = media.saveAs;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const bar = "flex size-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 disabled:opacity-50";
  return (
    <dialog
      ref={dialog}
      aria-label={media?.alt ?? t("viewer")}
      // Escape: let the history entry go too.
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-black/95 p-0 text-white backdrop:bg-black/80"
    >
      {media ? (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-[env(safe-area-inset-top)]">
            <button type="button" onClick={close} aria-label={t("close")} title={t("close")} className={bar}>
              <X aria-hidden="true" className="size-6" />
            </button>
            <div className="flex items-center gap-1">
              {media.kind === "image" ? (
                <button type="button" onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? t("fit") : t("zoom")} title={zoomed ? t("fit") : t("zoom")} className={bar}>
                  {zoomed ? <ZoomOut aria-hidden="true" className="size-5" /> : <ZoomIn aria-hidden="true" className="size-5" />}
                </button>
              ) : null}
              {media.saveAs ? (
                <button type="button" onClick={save} disabled={saving} aria-label={t("save")} title={t("save")} className={bar}>
                  {saving ? <LoaderCircle aria-hidden="true" className="size-5 animate-spin" /> : <Download aria-hidden="true" className="size-5" />}
                </button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p role="alert" className="mx-auto rounded-full bg-white/10 px-4 py-1.5 text-sm">{t("saveFailed")}</p>
          ) : null}
          <div
            className={cn("relative min-h-0 flex-1", zoomed ? "overflow-auto" : "flex items-center justify-center overflow-hidden p-2")}
            // A tap beside the picture closes it.
            onClick={(e) => {
              if (e.target === e.currentTarget && !zoomed) close();
            }}
          >
            {media.kind === "video" ? (
              <video src={media.src} controls autoPlay playsInline className="max-h-full max-w-full" aria-label={media.alt} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a private, signed or full-size original, shown as it is
              <img
                src={media.src}
                alt={media.alt}
                draggable={false}
                // Without «حفظ», no long-press «حفظ الصورة» either.
                onContextMenu={media.saveAs ? undefined : (e) => e.preventDefault()}
                onClick={() => setZoomed((z) => !z)}
                className={cn(
                  "select-none [-webkit-touch-callout:none]",
                  zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain",
                )}
              />
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
