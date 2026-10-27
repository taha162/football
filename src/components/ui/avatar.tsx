import Image from "next/image";
import { cn } from "@/lib/cn";
import { isLocalStorageHost } from "@/lib/env";

export function Avatar({ src, name, size = 40, className }: { src: string | null | undefined; name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 font-semibold text-muted", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
    >
      {src ? (
        <StorageImage src={src} alt="" width={size} height={size} className="size-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials || "?"}</span>
      )}
    </span>
  );
}

/** next/image for storage URLs; skips the optimizer for local development hosts. */
export function StorageImage({ alt, ...props }: { src: string; alt: string; width?: number; height?: number; fill?: boolean; className?: string; sizes?: string; priority?: boolean }) {
  return <Image alt={alt} {...props} unoptimized={isLocalStorageHost()} />;
}
