"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { isLocalStorageHost } from "@/lib/env";

/**
 * next/image for storage URLs. If the optimized copy cannot be produced, the
 * original file is loaded directly; if that fails too, `fallback` is shown
 * instead of the browser's broken-image mark. (next/image re-fires an error
 * that happened before hydration, so early failures are caught as well.)
 */
export function StorageImage({
  fallback = null,
  alt,
  ...props
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  sizes?: string;
  priority?: boolean;
  fallback?: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  if (attempt > 1) return <>{fallback}</>;
  return (
    <Image
      key={attempt}
      alt={alt}
      {...props}
      unoptimized={attempt === 1 || isLocalStorageHost()}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}
