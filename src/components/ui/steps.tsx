import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Numbered circles joined by a line, one per stage of a path: a check on the
 * ones done, the current one filled (aria-current="step"), the rest waiting.
 * The path runs with the page's direction (right to left in Arabic). Plain
 * strings in, so it renders anywhere.
 */
export function Steps({
  label,
  steps,
  current,
  doneLabel,
  className,
}: {
  /** What the steps are for, e.g. «خطوات التسجيل». */
  label: string;
  steps: string[];
  /** Index of the current step. */
  current: number;
  /** Read after a finished step's name, e.g. «مكتملة». */
  doneLabel: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("rounded-2xl border border-line bg-surface-2 px-2 py-3 sm:px-4", className)}>
      <ol className="flex items-start">
        {steps.map((name, i) => {
          const state = i < current ? "done" : i === current ? "current" : "upcoming";
          return (
            <li key={name} aria-current={state === "current" ? "step" : undefined} data-state={state} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
              {i < steps.length - 1 ? (
                // From this circle's edge to the next one's: half a step on each side, less the circles.
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-[17px] h-0.5 rounded-full [inset-inline-end:calc(-50%+24px)] [inset-inline-start:calc(50%+24px)]",
                    i < current ? "bg-accent" : "bg-line-strong",
                  )}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "num relative grid size-9 place-items-center rounded-full border-2 text-sm font-semibold transition-colors",
                  state === "done" && "border-accent/80 text-accent",
                  state === "current" && "border-accent bg-accent text-accent-ink shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-accent)_22%,transparent)]",
                  state === "upcoming" && "border-line-strong text-faint",
                )}
              >
                {state === "done" ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-xs leading-tight", state === "current" ? "font-semibold text-ink" : state === "done" ? "text-muted" : "text-faint")}>
                {name}
                {state === "done" ? <span className="sr-only"> ({doneLabel})</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
