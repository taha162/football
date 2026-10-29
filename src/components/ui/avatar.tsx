import { UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { StorageImage } from "./storage-image";

export { StorageImage };

export function Avatar({ src, name, size = 40, className }: { src: string | null | undefined; name: string; size?: number; className?: string }) {
  // Letters only: a missing name (or a "?" placeholder) shows a person icon.
  const initials = name
    .split(/\s+/)
    .map((part) => Array.from(part).find((ch) => /\p{L}/u.test(ch)))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const fallback = initials ? <span aria-hidden="true">{initials}</span> : <UserRound aria-hidden="true" className="size-1/2" />;
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 font-semibold text-muted", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
    >
      {src ? <StorageImage src={src} alt="" width={size} height={size} className="size-full object-cover" fallback={fallback} /> : fallback}
    </span>
  );
}
