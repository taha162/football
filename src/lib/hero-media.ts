/**
 * Cinematic hero media. Real footage is configured per deployment (it is not
 * bundled): point these at files in /public/media/landing/ or at any HTTPS
 * host (e.g. a public Supabase Storage bucket). `scripts/prepare-hero-video.sh`
 * produces all variants from one source clip. Only use footage you are
 * licensed to publish.
 *
 * Without a video the hero shows the poster; without a poster it shows the
 * bundled night-pitch illustration (vector, labelled as an illustration).
 */
export interface HeroMedia {
  mp4: string | null;
  webm: string | null;
  mobileMp4: string | null;
  poster: string;
  mobilePoster: string | null;
  /** CSS object-position for the footage, e.g. "50% 60%". */
  focus: string;
  /** Licence/attribution line for the footage, if the licence asks for one. */
  credit: string | null;
  isIllustration: boolean;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export const FALLBACK_POSTER = "/media/landing/pitch-night.svg";

export function heroMedia(): HeroMedia {
  const poster = clean(process.env.NEXT_PUBLIC_HERO_POSTER);
  return {
    mp4: clean(process.env.NEXT_PUBLIC_HERO_VIDEO_MP4),
    webm: clean(process.env.NEXT_PUBLIC_HERO_VIDEO_WEBM),
    mobileMp4: clean(process.env.NEXT_PUBLIC_HERO_VIDEO_MOBILE_MP4),
    poster: poster ?? FALLBACK_POSTER,
    mobilePoster: clean(process.env.NEXT_PUBLIC_HERO_POSTER_MOBILE),
    focus: clean(process.env.NEXT_PUBLIC_HERO_FOCUS) ?? "50% 55%",
    credit: clean(process.env.NEXT_PUBLIC_HERO_CREDIT),
    isIllustration: !poster,
  };
}
