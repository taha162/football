"use client";

import { publicEnv } from "@/lib/env";
import { POSTER_MAX_SIDE } from "@/lib/message-video";

/**
 * A chosen video's length (whole seconds) and a still from it (a small JPEG),
 * read in the browser. Either may be missing: a phone format this browser
 * can't decode (an iPhone's HEVC on an older computer, say) is still sent,
 * just without them.
 */
export async function readVideo(file: File): Promise<{ seconds: number | null; still: File | null }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const once = (event: string, ms = 8000) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      video.addEventListener(
        event,
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("unreadable"));
        },
        { once: true },
      );
    });
  let seconds: number | null = null;
  try {
    const meta = once("loadedmetadata");
    video.src = url;
    await meta;
    seconds = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(1, Math.round(video.duration)) : null;
    // A frame a little in (the very first is often black).
    const seeked = once("seeked");
    video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
    await seeked;
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    return { seconds, still: blob && video.videoWidth ? new File([blob], "still.jpg", { type: "image/jpeg" }) : null };
  } catch {
    return { seconds, still: null };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Sends the file straight to storage through the one-time link the server
 * gave (server/messages.ts startVideoUpload), reporting progress (0 to 1).
 * `holder` keeps the request, so the member can cancel it.
 */
export function uploadVideo(
  url: string,
  file: File,
  type: string,
  onProgress: (share: number) => void,
  holder: { current: XMLHttpRequest | null },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    holder.current = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", type);
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    xhr.setRequestHeader("x-upsert", "false");
    if (publicEnv.supabaseAnonKey) xhr.setRequestHeader("apikey", publicEnv.supabaseAnonKey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      holder.current = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.status === 413 ? "video_too_large" : "upload_failed"));
    };
    xhr.onerror = () => {
      holder.current = null;
      reject(new Error("upload_failed"));
    };
    xhr.onabort = () => {
      holder.current = null;
      reject(new Error("cancelled"));
    };
    xhr.send(file);
  });
}
