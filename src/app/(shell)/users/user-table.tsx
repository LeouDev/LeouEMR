"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateUser } from "./actions";
import { ResetMfaButton } from "./reset-mfa-button";
import { mfaRequiredFor } from "@/lib/auth/mfa";
import { describeActionError } from "@/lib/ui/action-error";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "supervisor" | "agent";
  status: "active" | "pending" | "disabled";
  employeeEid: string | null;
  managerName: string | null;
  signedUpAs: string | null;
  /** Null when unlinked; whether `employeeEid` resolves to a real roster row otherwise. */
  eidMatches: boolean | null;
  /** Whether an authenticator app is paired with the account (see src/lib/auth/mfa.ts); null when unknown. */
  mfaEnrolled: boolean | null;
}

const ROLES = ["admin", "manager", "supervisor", "agent"] as const;

/**
 * The role a sign-up position implies.
 *
 * Deliberately only a hint shown next to the control, never applied on its
 * own: anyone can sign up with any email and pick "Manager" from a list, so
 * treating that claim as an assignment would let a stranger read a whole
 * span's data. An administrator still chooses the role by hand.
 */
const IMPLIED_ROLE: Record<string, string> = {
  Manager: "manager",
  Supervisor: "supervisor",
};
const STATUSES = ["active", "pending", "disabled"] as const;

const control =
  "border-2 border-ink bg-surface px-2 py-1 text-sm text-ink outline-none transition disabled:opacity-50";

export function UserTable({
  users,
  currentUserId,
  managerNames,
}: {
  users: UserRow[];
  currentUserId: string;
  /** Manager names present in the imported data, for the span link. */
  managerNames: string[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-ink bg-cream">
            <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">User</th>
            <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Role</th>
            <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
            <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Employee ID</th>
            <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Manager span / cluster</th>
            <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">Authenticator</th>
            <th className="px-6 py-2.5 font-semibold text-ink">Save</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRowEditor
              key={user.id}
              user={user}
              isSelf={user.id === currentUserId}
              managerNames={managerNames}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRowEditor({
  user,
  isSelf,
  managerNames,
}: {
  user: UserRow;
  isSelf: boolean;
  managerNames: string[];
}) {
  const router = useRouter();
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [eid, setEid] = useState(user.employeeEid ?? "");
  const [managerName, setManagerName] = useState(user.managerName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    role !== user.role ||
    status !== user.status ||
    eid !== (user.employeeEid ?? "") ||
    managerName !== (user.managerName ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    let result;
    try {
      result = await updateUser({
        userId: user.id,
        role,
        status,
        employeeEid: eid,
        managerName,
      });
    } catch (cause) {
      setError(describeActionError(cause));
      return;
    } finally {
      setSaving(false);
    }

    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <tr className="border-b border-line/70 last:border-0">
      <td className="px-6 py-2">
        <p className="font-medium text-ink">{user.name}</p>
        <p className="text-xs text-muted">{user.email}</p>
        {error && <p className="mt-1 text-xs text-fail">{error}</p>}
        {saved && !error && <p className="mt-1 text-xs text-pass">Saved</p>}
      </td>
      <td className="px-3 py-2">
        <select
          value={role}
          disabled={isSelf}
          onChange={(e) => setRole(e.target.value as UserRow["role"])}
          className={control}
        >
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {user.signedUpAs && (
          <p className="mt-1 text-[10px] leading-tight text-muted">
            signed up as{" "}
            <span
              className={
                IMPLIED_ROLE[user.signedUpAs] && IMPLIED_ROLE[user.signedUpAs] !== role
                  ? "font-bold text-orange-brand-dark"
                  : "font-semibold text-ink"
              }
            >
              {user.signedUpAs}
            </span>
          </p>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          value={status}
          disabled={isSelf}
          onChange={(e) => setStatus(e.target.value as UserRow["status"])}
          className={control}
        >
          {STATUSES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={eid}
          disabled={isSelf}
          placeholder="Not linked"
          onChange={(e) => setEid(e.target.value)}
          className={`${control} w-32 font-mono`}
        />
        {/* Only shown for the untouched, already-saved value — the save
            action itself is what validates whatever is typed next. */}
        {eid === (user.employeeEid ?? "") && eid !== "" && user.eidMatches === false && (
          <p className="mt-1 text-[10px] font-bold text-fail">No matching employee</p>
        )}
      </td>
      <td className="px-3 py-2">
        {role === "manager" || role === "supervisor" ? (
          <select
            value={managerName}
            disabled={isSelf}
            onChange={(e) => setManagerName(e.target.value)}
            className={`${control} max-w-56`}
            aria-label={role === "manager" ? `Manager span for ${user.name}` : `Cluster for ${user.name}`}
          >
            {/* A team leader's cluster normally comes from the roster; the
                link only stands in for a month the roster gives them no team. */}
            <option value="">{role === "manager" ? "Not linked — sees nobody" : "From the roster"}</option>
            {managerNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <MfaCell user={user} role={role} />
      </td>
      <td className="px-6 py-2">
        {isSelf ? (
          <span className="text-xs text-muted">Your account</span>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary px-4 py-2 text-sm"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Paired, or not — and for a role that must pair, "not" is the thing an
 * administrator needs to see. The reset removes the pairing so someone with
 * a new phone can pair again; it is offered only where there is one.
 */
function MfaCell({ user, role }: { user: UserRow; role: UserRow["role"] }) {
  if (user.mfaEnrolled === null) return <span className="text-xs text-muted">Unavailable</span>;
  if (user.mfaEnrolled) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-pass">Paired</span>
        <ResetMfaButton userId={user.id} name={user.name} />
      </div>
    );
  }
  return (
    <span className={`text-xs ${mfaRequiredFor(role) ? "font-semibold text-warn" : "text-muted"}`}>
      {mfaRequiredFor(role) ? "Not paired — required" : "—"}
    </span>
  );
}
