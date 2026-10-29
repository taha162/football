import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/** A panel; below the fold it rises into place when scrolled to (`reveal`, see components/motion/reveal.ts). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("reveal rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 sm:p-5", className)} {...props} />;
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line",
  accent: "bg-accent/12 text-accent border-accent/30",
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-danger/12 text-danger border-danger/30",
  info: "bg-info/12 text-info border-info/30",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", toneClass[tone], className)}>
      {children}
    </span>
  );
}

const alertIcon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle } as const;

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = alertIcon[tone];
  return (
    <div data-tone={tone} className={cn("flex gap-3 rounded-xl border p-3.5 text-sm", toneClass[tone], className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1 text-ink">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="reveal flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line px-6 py-12 text-center">
      {icon ? <div className="text-faint" aria-hidden="true">{icon}</div> : null}
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5">
        {eyebrow ? <p className="reveal text-xs font-semibold uppercase tracking-widest text-accent">{eyebrow}</p> : null}
        <h1 className="reveal page-title font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description ? <p className="reveal max-w-2xl text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="reveal flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn("flex flex-col gap-4", className)} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {title || actions ? (
        <div className="reveal flex items-center justify-between gap-3">
          {title ? (
            <h2 id={id ? `${id}-title` : undefined} className="font-display text-xl font-semibold">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)} {...props} />;
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="reveal flex flex-col gap-1 rounded-xl border border-line bg-surface-2 p-4">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="num font-display text-2xl font-bold">{value}</dd>
      {hint ? <dd className="text-xs text-faint">{hint}</dd> : null}
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">{it.label}</dt>
          <dd className="text-sm text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
