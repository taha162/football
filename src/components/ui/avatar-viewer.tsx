"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Avatar } from "./avatar";
import { MediaViewer, type ViewedMedia } from "./media-viewer";

/**
 * A profile picture that opens large inside the site on a tap, with no «حفظ»
 * (and no long-press «حفظ الصورة»). Without a picture: the plain avatar.
 */
export function AvatarViewer({ src, name, size }: { src: string | null; name: string; size: number }) {
  const t = useTranslations("media");
  const [media, setMedia] = useState<ViewedMedia | null>(null);
  if (!src) return <Avatar src={null} name={name} size={size} />;
  return (
    <>
      <button
        type="button"
        onClick={() => setMedia({ kind: "image", src, alt: t("profilePicture", { name }) })}
        aria-label={t("openProfilePicture", { name })}
        className="shrink-0 rounded-full transition-transform active:scale-95"
      >
        <Avatar src={src} name={name} size={size} />
      </button>
      <MediaViewer media={media} onClose={() => setMedia(null)} />
    </>
  );
}
