"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "../icons";
import { buttonClass } from "../ui";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/app/actions/shared";

export function FormBanner({ state }: { state: ActionState }) {
  if (!state.error && !state.ok && !(state.warnings && state.warnings.length > 0)) return null;

  return (
    <div className="mb-4 space-y-3">
      {state.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex items-start gap-2">
            <Icon name="warning" className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{state.error}</div>
              {state.hint ? <div className="mt-1 text-rose-800/80">{state.hint}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {state.ok && !state.error ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex items-start gap-2">
            <Icon name="check-circle" className="mt-0.5 size-4 shrink-0" />
            <div className="font-medium">{state.ok}</div>
          </div>
        </div>
      ) : null}

      {state.warnings && state.warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <ul className="space-y-1">
              {state.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  variant = "primary",
  className,
  icon,
  formAction,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  icon?: string;
  /**
   * Send this button's submission to a different action than the form's own —
   * how one set of fields can drive two operations, e.g. scan a folder or ask
   * Drive why it looks empty.
   */
  formAction?: (payload: FormData) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      formAction={formAction}
      className={buttonClass(variant, className)}
    >
      {pending ? (
        <Icon name="refresh" className="size-4 animate-spin" />
      ) : icon ? (
        <Icon name={icon} className="size-4" />
      ) : null}
      {pending ? pendingLabel : children}
    </button>
  );
}

export type CardOption = {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  tint?: string;
};

/** Radio group rendered as selectable cards — used for type and visibility. */
export function RadioCards({
  name,
  options,
  value,
  onChange,
  columns = 3,
}: {
  name: string;
  options: CardOption[];
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={cn("grid gap-2", columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}
      role="radiogroup"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative flex cursor-pointer gap-2.5 rounded-xl border p-3 transition",
              selected
                ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-300"
                : "border-ink-200 bg-white hover:border-ink-300",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon ? (
              <span
                className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg"
                style={{
                  backgroundColor: option.tint ? `${option.tint}18` : undefined,
                  color: option.tint,
                }}
              >
                <Icon name={option.icon} className="size-4" />
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink-900">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                  {option.description}
                </span>
              ) : null}
            </span>
            {selected ? (
              <Icon name="check" className="absolute right-2 top-2 size-3.5 text-brand-600" />
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

export function Toggle({
  name,
  label,
  hint,
  defaultChecked,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-200 bg-white p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
      />
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-500">{hint}</span> : null}
      </span>
    </label>
  );
}
