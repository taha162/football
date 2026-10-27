import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 select-none whitespace-nowrap";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "bg-surface-3 text-ink hover:bg-line-strong",
  outline: "border border-line-strong text-ink hover:bg-surface-2",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...props} />;
});
