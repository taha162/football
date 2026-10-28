import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative flex justify-center px-4 py-12 sm:py-20">
      <div aria-hidden="true" className="pitch-lines pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <div className="relative flex w-full max-w-md flex-col gap-6 rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-bold">{title}</h1>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
        {children}
        {footer ? <div className="border-t border-line pt-4 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}
