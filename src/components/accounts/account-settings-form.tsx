"use client";

import { useActionState } from "react";
import { archiveAccountAction, updateAccountAction } from "@/app/accounts/actions";
import type { AccountFormState } from "@/lib/accounts/validation";

const INITIAL_STATE: AccountFormState = {};

export function AccountSettingsForm({
  accountId,
  name,
  includeInAssets,
}: {
  accountId: string;
  name: string;
  includeInAssets: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateAccountAction, INITIAL_STATE);
  const errors = state.errors;

  return (
    <form action={formAction} className="space-y-5">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
      <input name="accountId" type="hidden" value={accountId} />

      <div>
        <label className="account-field-label" htmlFor="rename-account">Account name</label>
        <input
          aria-describedby={errors?.name ? "rename-account-error" : undefined}
          aria-invalid={Boolean(errors?.name)}
          className="account-field-control"
          defaultValue={name}
          id="rename-account"
          name="name"
          required
        />
        {errors?.name && <p className="account-field-error" id="rename-account-error">{errors.name}</p>}
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] leading-6 text-ink">
        <input
          aria-describedby={errors?.includeInAssets ? "include-assets-error" : undefined}
          aria-invalid={Boolean(errors?.includeInAssets)}
          className="account-checkbox mt-1"
          defaultChecked={includeInAssets}
          name="includeInAssets"
          type="checkbox"
          value="on"
        />
        <span>Include in tracked assets</span>
      </label>
      {errors?.includeInAssets && <p className="account-field-error" id="include-assets-error">{errors.includeInAssets}</p>}

      <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-border bg-raised px-4 text-[14px] font-medium text-ink transition-colors hover:bg-[#282828] disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={pending} type="submit">
        {pending ? "Saving changes…" : "Save account changes"}
      </button>
    </form>
  );
}

export function ArchiveAccountForm({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [state, formAction, pending] = useActionState(archiveAccountAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
      <input name="accountId" type="hidden" value={accountId} />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[13px] leading-6 text-muted">
        <input className="account-checkbox mt-1" name="confirmArchive" required type="checkbox" value="on" />
        <span>I understand {accountName} will become read-only and cannot receive new account activity.</span>
      </label>
      <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-[#633f3f] bg-[#251919] px-4 text-[14px] font-medium text-[#f2c5c5] transition-colors hover:bg-[#382222] disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={pending} type="submit">
        {pending ? "Archiving account…" : "Archive account"}
      </button>
    </form>
  );
}
