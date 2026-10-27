import "server-only";
import { cache } from "react";

/**
 * The current time for this request. Memoized so every component rendered
 * for one request sees the same instant (and render stays deterministic).
 */
export const getNow = cache((): number => Date.now());
