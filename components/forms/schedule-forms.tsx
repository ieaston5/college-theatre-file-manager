"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  refreshCanvaNowAction,
  runNowAction,
  saveScheduleAction,
} from "@/app/actions/scheduled";
import { emptyState } from "@/app/actions/shared";
import { Field, selectClass } from "../ui";
import { FormBanner, SubmitButton, Toggle } from "./form-bits";

const DAYS = [
  { value: "never", label: "Never" },
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

export function ScheduleForm({
  digestDay,
  canvaAutoRefresh,
  emailEnabled,
  canvaAvailable,
}: {
  digestDay: number | null;
  canvaAutoRefresh: boolean;
  emailEnabled: boolean;
  canvaAvailable: boolean;
}) {
  const [saveState, saveAction] = useActionState(saveScheduleAction, emptyState);
  const [runState, runAction] = useActionState(runNowAction, emptyState);
  const [canvaState, canvaAction] = useActionState(refreshCanvaNowAction, emptyState);

  return (
    <div className="space-y-5">
      <form action={saveAction} className="space-y-4">
        <FormBanner state={saveState} />

        <Field
          label="Send the weekly digest on"
          htmlFor="digestDay"
          hint={
            emailEnabled
              ? "Monday morning tends to work: it lands before the week's rehearsals rather than after them."
              : "Email is switched off, so this will not send anything until you turn it on in Admin → Email."
          }
        >
          <select
            id="digestDay"
            name="digestDay"
            defaultValue={digestDay === null ? "never" : String(digestDay)}
            className={selectClass}
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </Field>

        {canvaAvailable ? (
          <Toggle
            name="canvaAutoRefresh"
            label="Keep Canva copies up to date on their own"
            hint="Checks each mirrored design on every scheduled run and re-exports the ones that have changed and then gone quiet for half an hour. Without this, somebody has to press the button on each document."
            defaultChecked={canvaAutoRefresh}
          />
        ) : null}

        <div className="flex justify-end">
          <SubmitButton icon="check">Save the schedule</SubmitButton>
        </div>
      </form>

      <div className="space-y-3 border-t border-ink-100 pt-4">
        <FormBanner state={runState} />
        <FormBanner state={canvaState} />
        <div className="flex flex-wrap items-center gap-2">
          <form action={runAction}>
            <SubmitButton variant="secondary" icon="refresh" pendingLabel="Running…">
              Run everything now
            </SubmitButton>
          </form>
          {canvaAvailable ? (
            <form action={canvaAction}>
              <SubmitButton variant="secondary" icon="canva" pendingLabel="Re-exporting…">
                Refresh Canva copies now
              </SubmitButton>
            </form>
          ) : null}
          <Link href="/admin/email" className="text-xs text-ink-500 hover:text-ink-800">
            Digest settings →
          </Link>
        </div>
        <p className="text-xs text-ink-500">
          “Run everything now” does exactly what the scheduled job does and nothing more — so a design
          somebody edited a minute ago is noticed but left alone until they stop typing. Use “Refresh
          Canva copies now” to skip that wait.
        </p>
      </div>
    </div>
  );
}
