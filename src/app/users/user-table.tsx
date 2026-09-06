"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateUser } from "./actions";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "supervisor" | "agent";
  status: "active" | "pending" | "disabled";
  employeeEid: string | null;
}

const ROLES = ["admin", "manager", "supervisor", "agent"] as const;
const STATUSES = ["active", "pending", "disabled"] as const;

const control =
  "rounded-lg border border-line bg-surface px-2 py-1 text-sm text-navy-900 outline-none transition focus:border-navy focus:ring-2 focus:ring-navy-100 disabled:opacity-50";

export function UserTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-cream text-left">
            <th className="px-6 py-2.5 font-semibold text-navy-800">User</th>
            <th className="px-3 py-2.5 font-semibold text-navy-800">Role</th>
            <th className="px-3 py-2.5 font-semibold text-navy-800">Status</th>
            <th className="px-3 py-2.5 font-semibold text-navy-800">Employee ID</th>
            <th className="px-6 py-2.5 text-right font-semibold text-navy-800">Save</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRowEditor key={user.id} user={user} isSelf={user.id === currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRowEditor({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [eid, setEid] = useState(user.employeeEid ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = role !== user.role || status !== user.status || eid !== (user.employeeEid ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await updateUser({ userId: user.id, role, status, employeeEid: eid });
    setSaving(false);

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
        <p className="font-medium text-navy-900">{user.name}</p>
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
      </td>
      <td className="px-6 py-2 text-right">
        {isSelf ? (
          <span className="text-xs text-muted">Your account</span>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-navy-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-navy-900 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </td>
    </tr>
  );
}
