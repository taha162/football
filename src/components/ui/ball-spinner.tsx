import { cn } from "@/lib/cn";

/** A football rolling in the reading direction: the pending indicator inside buttons. */
export function BallSpinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("ball-spin size-4 shrink-0", className)}>
      <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7.4l4.37 3.18-1.67 5.14H9.3l-1.67-5.14z" fill="currentColor" />
      <path
        d="M12 7.4V2.75M16.37 10.58l4.43-1.44M14.7 15.72l2.74 3.76M9.3 15.72l-2.74 3.76M7.63 10.58L3.2 9.14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
