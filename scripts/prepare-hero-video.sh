#!/usr/bin/env bash
# Prepares the landing-page hero footage from one source clip you are licensed
# to publish. Produces web-optimized variants plus poster frames:
#
#   stadium-1080.mp4        H.264, 1920x1080 cover crop, no audio, fast start
#   stadium-1080.webm       VP9 equivalent (smaller in Chrome/Firefox)
#   stadium-mobile.mp4      720x1280 portrait crop for phones
#   stadium-poster.jpg      first frame (also the LCP image)
#   stadium-poster-mobile.jpg
#
# Usage: scripts/prepare-hero-video.sh <source> [start_sec=0] [duration_sec=12] [out_dir=public/media/landing]
# Env:   FOCUS_X=0.5   horizontal focus (0..1) of the portrait crop
#        CRF=24        H.264 quality (lower = better/larger)
set -euo pipefail

src="${1:?usage: $0 <source> [start] [duration] [out_dir]}"
start="${2:-0}"
dur="${3:-12}"
out="${4:-public/media/landing}"
focus="${FOCUS_X:-0.5}"
crf="${CRF:-24}"
mkdir -p "$out"

common=(-hide_banner -loglevel error -y -ss "$start" -t "$dur" -i "$src" -an)
wide="scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p"
tall="scale=-2:1280,crop=720:1280:(in_w-720)*${focus}:0,fps=30,format=yuv420p"

ffmpeg "${common[@]}" -vf "$wide" -c:v libx264 -preset slow -crf "$crf" -profile:v high -movflags +faststart "$out/stadium-1080.mp4"
ffmpeg "${common[@]}" -vf "$wide" -c:v libvpx-vp9 -b:v 0 -crf 36 -row-mt 1 -deadline good "$out/stadium-1080.webm"
ffmpeg "${common[@]}" -vf "$tall" -c:v libx264 -preset slow -crf $((crf + 2)) -profile:v high -movflags +faststart "$out/stadium-mobile.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$out/stadium-1080.mp4" -frames:v 1 -q:v 3 "$out/stadium-poster.jpg"
ffmpeg -hide_banner -loglevel error -y -i "$out/stadium-mobile.mp4" -frames:v 1 -q:v 3 "$out/stadium-poster-mobile.jpg"

echo "Created in $out:"
ls -lh "$out"/stadium-* | awk '{print "  " $5 "  " $9}'
rel="/${out#public/}"
cat <<ENV

Set these (Vercel → Settings → Environment Variables, or .env.local), then redeploy:
  NEXT_PUBLIC_HERO_VIDEO_MP4=$rel/stadium-1080.mp4
  NEXT_PUBLIC_HERO_VIDEO_WEBM=$rel/stadium-1080.webm
  NEXT_PUBLIC_HERO_VIDEO_MOBILE_MP4=$rel/stadium-mobile.mp4
  NEXT_PUBLIC_HERO_POSTER=$rel/stadium-poster.jpg
  NEXT_PUBLIC_HERO_POSTER_MOBILE=$rel/stadium-poster-mobile.jpg
  # optional: NEXT_PUBLIC_HERO_FOCUS="50% 60%"  NEXT_PUBLIC_HERO_CREDIT="Name / Source"
ENV
