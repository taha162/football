"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { bringIntoView } from "@/components/motion/scroll";

/** Glides its content into view when it appears, e.g. the price after a time is picked. Key it to re-run. */
export function BringIntoView({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) bringIntoView(ref.current);
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
