import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about the custom design-token colors.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: ["bg", "surface", "surface-2", "surface-3", "line", "line-strong", "ink", "muted", "faint", "accent", "accent-strong", "accent-ink", "pitch", "danger", "warning", "info", "success"],
    },
  },
});

/** Joins class names, letting later Tailwind utilities override earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
