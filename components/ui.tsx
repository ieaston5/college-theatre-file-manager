import type { ReactNode } from "react";
import { cn, initials } from "@/lib/utils";
import type { Tone } from "@/lib/constants";
import { Icon } from "./icons";

// --- tones ------------------------------------------------------------------

const TONE_CLASSES: Record<Tone, string> = {
  indigo: "bg-brand-50 text-brand-700 ring-brand-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  slate: "bg-ink-100 text-ink-600 ring-ink-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({
  children,
  tone = "slate",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} className="size-3" /> : null}
      {children}
    </span>
  );
}

// --- buttons ----------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(variant: ButtonVariant = "secondary", extra?: string) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    secondary: "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50",
    ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
    danger: "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
  };
  return cn(base, variants[variant], extra);
}

export function Button({
  children,
  variant = "secondary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button className={buttonClass(variant, className)} {...rest}>
      {children}
    </button>
  );
}

// --- surfaces ---------------------------------------------------------------

export function Card({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li" | "article";
}) {
  return <As className={cn("card p-5", className)}>{children}</As>;
}

export function SectionHeader({
  title,
  description,
  action,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <Icon name={icon} className="size-5" />
          </span>
        ) : null}
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink-900">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon = "folder",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white/60 px-6 py-12 text-center">
      <span className="mb-3 grid size-11 place-items-center rounded-full bg-ink-100 text-ink-500">
        <Icon name={icon} className="size-5" />
      </span>
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {children ? <p className="mt-1 max-w-md text-sm text-ink-500">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Banner({
  tone = "indigo",
  title,
  children,
  action,
  icon,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: string;
}) {
  const border: Record<Tone, string> = {
    indigo: "border-brand-200 bg-brand-50 text-brand-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    slate: "border-ink-200 bg-ink-100 text-ink-800",
    violet: "border-violet-200 bg-violet-50 text-violet-900",
  };
  return (
    <div className={cn("mb-5 flex flex-wrap items-start gap-3 rounded-xl border p-4", border[tone])}>
      {icon ? <Icon name={icon} className="mt-0.5 size-5 shrink-0" /> : null}
      {/* min-w-56 makes the action wrap below on narrow screens instead of
          squeezing the message into a column of single words. */}
      <div className="min-w-56 flex-1 text-sm">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? (
          <div className={cn(title ? "mt-0.5" : null, "opacity-90")}>{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// --- form primitives --------------------------------------------------------

export const inputClass =
  "w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200";

export const selectClass = cn(inputClass, "pr-8");

export function Field({
  label,
  hint,
  htmlFor,
  children,
  required,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-800">
        {label}
        {required ? <span className="ml-0.5 text-rose-600">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</span>
        {icon ? <Icon name={icon} className="size-4 text-ink-400" /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </>
  );
  if (href) {
    return (
      <a href={href} className="card block p-4 transition hover:border-brand-300 hover:shadow-sm">
        {inner}
      </a>
    );
  }
  return <div className="card p-4">{inner}</div>;
}

export function Avatar({
  name,
  email,
  size = 32,
  className,
}: {
  name?: string | null;
  email: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700",
        className,
      )}
      style={{ width: size, height: size }}
      title={email}
    >
      {initials(name, email)}
    </span>
  );
}

export function Dot() {
  return <span className="px-1.5 text-ink-300">·</span>;
}
