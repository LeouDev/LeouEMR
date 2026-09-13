"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { removeMyAvatar, updateMyAvatar, updateMyProfile } from "@/app/(shell)/profile/actions";
import { AVATAR_SIZE, AVATAR_TYPES, avatarUrl } from "@/lib/profile/avatar";
import { NO_PROFILE, initialsOf, validateProfileForm, type ProfileForm } from "@/lib/profile/panel";
import { describeActionError } from "@/lib/ui/action-error";

export interface ProfilePanelProps {
  account: { name: string; email: string; roleLabel: string; employeeEid: string | null };
  /** The personnel record captured at sign-up; null for an account without one. */
  profile: (ProfileForm & { employeeEid: string; position: string }) | null;
  /** The roster's team leader and manager for the linked employee; null when the account is not linked. */
  org: { supervisorName: string | null; managerName: string | null } | null;
  /** Role-appropriate shortcuts; empty hides the section. */
  quickLinks: Array<{ href: string; label: string }>;
  /** The profile picture's version (its row's timestamp), or null when there is none. */
  avatarVersion: number | null;
}

const heading = "mb-3.5 text-xs font-bold tracking-[0.1em] text-ink-muted uppercase";
const label = "mb-1.5 block text-[10px] font-bold tracking-[0.08em] text-ink-faint uppercase";
const input = "w-full border-2 border-ink bg-surface px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint";
const linkButton = "btn-secondary w-full px-3.5 py-2.5 text-[13px]";

function sameForm(a: ProfileForm, b: ProfileForm): boolean {
  return (Object.keys(a) as Array<keyof ProfileForm>).every((key) => a[key] === b[key]);
}

/**
 * The chosen photo cut to a centred square of AVATAR_SIZE pixels, as a
 * data URL — WebP where the browser can encode it, JPEG otherwise. Done
 * here so the upload is a few tens of kilobytes whatever the camera made.
 */
async function squareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

/** The picture, or the initials while there is none. Grayscale like every photo in the app. */
function Avatar({ name, version, className }: { name: string; version: number | null; className: string }) {
  if (version !== null) {
    // A plain img on purpose: the picture is a private 256px route of the
    // caller's own, already resized by the browser that uploaded it —
    // next/image's optimizer would add a hop and nothing else.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl(version)} alt="" className={`${className} object-cover`} />;
  }
  return (
    <span aria-hidden className={`${className} flex items-center justify-center font-bold text-cream`}>
      {initialsOf(name)}
    </span>
  );
}

/**
 * The name in the header is a button; this is what it opens — a panel from
 * the right edge where a person reads and edits their own personnel
 * details without leaving the page: names, contact, address, emergency
 * contact. The roster's fields (employee ID, position, team leader,
 * manager) are shown, never edited. The form is seeded from the row the
 * layout read on the server, so opening the panel costs no round trip.
 */
export function ProfilePanel({ account, profile, org, quickLinks, avatarVersion }: ProfilePanelProps) {
  const [open, setOpen] = useState(false);
  const [avatar, setAvatar] = useState<number | null>(avatarVersion);
  const [photoStatus, setPhotoStatus] = useState<{ tone: "muted" | "fail"; text: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<ProfileForm | null>(profile);
  const [form, setForm] = useState<ProfileForm | null>(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close() reads the latest saved form through state setters, so the
    // listener need not be rebound on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!confirmed) return;
    const id = setTimeout(() => setConfirmed(false), 2000);
    return () => clearTimeout(id);
  }, [confirmed]);

  function close() {
    setForm(saved);
    setError(null);
    setPhotoStatus(null);
    setOpen(false);
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
      setPhotoStatus({ tone: "fail", text: "Choose a PNG, JPEG or WebP picture." });
      return;
    }
    setPhotoStatus({ tone: "muted", text: "Uploading…" });
    try {
      const image = await squareDataUrl(file);
      const result = await updateMyAvatar({ image });
      if (!result.ok) {
        setPhotoStatus({ tone: "fail", text: result.error });
      } else {
        setAvatar(result.version);
        setPhotoStatus(null);
      }
    } catch (cause) {
      setPhotoStatus({ tone: "fail", text: describeActionError(cause, "That picture could not be read — try another photo.") });
    }
  }

  async function removePhoto() {
    setPhotoStatus({ tone: "muted", text: "Removing…" });
    try {
      const result = await removeMyAvatar();
      if (!result.ok) setPhotoStatus({ tone: "fail", text: result.error });
      else {
        setAvatar(null);
        setPhotoStatus(null);
      }
    } catch (cause) {
      setPhotoStatus({ tone: "fail", text: describeActionError(cause) });
    }
  }

  function set(key: keyof ProfileForm) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setForm((current) => (current ? { ...current, [key]: value } : current));
      setConfirmed(false);
    };
  }

  async function save() {
    if (!form) return;
    const checked = validateProfileForm(form);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await updateMyProfile(checked.value);
      if (!result.ok) {
        setError(result.error);
      } else {
        setSaved(result.profile);
        setForm(result.profile);
        setConfirmed(true);
      }
    } catch (cause) {
      setError(describeActionError(cause));
    } finally {
      setSaving(false);
    }
  }

  const dirty = form !== null && saved !== null && !sameForm(form, saved);
  const field = (key: keyof ProfileForm, title: string, extra: { placeholder?: string; type?: string; inputMode?: "tel" | "numeric" } = {}) => (
    <label className="block">
      <span className={label}>{title}</span>
      <input
        type={extra.type ?? "text"}
        inputMode={extra.inputMode}
        value={form?.[key] ?? ""}
        placeholder={extra.placeholder}
        maxLength={200}
        onChange={set(key)}
        className={input}
      />
    </label>
  );
  const readOnly = (title: string, value: string | null | undefined) => (
    <div>
      <p className={label}>{title}</p>
      <p className="text-[13px] text-ink-muted">{value || "—"}</p>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Your profile"
        className="hidden items-center gap-2.5 border-2 border-transparent px-1.5 py-0.5 text-right leading-tight transition hover:border-orange-brand sm:flex"
      >
        <Avatar name={account.name} version={avatar} className="h-8 w-8 shrink-0 rounded-full border-2 border-navy-500 bg-navy-500 text-[11px]" />
        <span className="block">
          <span className="block text-sm font-semibold whitespace-nowrap text-cream">{account.name}</span>
          <span className="block text-[10px] font-bold tracking-[0.12em] whitespace-nowrap text-orange-brand uppercase">
            {account.roleLabel}
          </span>
        </span>
      </button>

      {open && (
        <>
          <div
            onClick={close}
            aria-hidden
            className="fixed inset-0 z-40 animate-[fadeIn_0.15s_ease-out] bg-navy-900/60 motion-reduce:animate-none"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Your profile"
            className="fixed top-0 right-0 bottom-0 z-50 flex w-[min(420px,100vw)] animate-[slideInRight_0.22s_ease-out] flex-col border-l-2 border-ink bg-surface motion-reduce:animate-none"
          >
            <div className="flex shrink-0 items-start gap-3.5 border-b-2 border-orange-brand bg-navy-800 p-5">
              <Avatar name={account.name} version={avatar} className="h-14 w-14 shrink-0 rounded-full border-2 border-orange-brand bg-navy-500 text-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-bold text-cream">{account.name}</p>
                <p className="mt-1 text-[10px] font-bold tracking-[0.12em] text-orange-brand uppercase">{account.roleLabel}</p>
                <p className="mt-1 truncate text-xs text-cream/70">{account.email}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => photoInput.current?.click()}
                    className="text-[10px] font-bold tracking-[0.08em] text-cream/80 uppercase underline-offset-4 transition hover:text-orange-brand hover:underline"
                  >
                    {avatar === null ? "Add photo" : "Change photo"}
                  </button>
                  {avatar !== null && (
                    <button
                      type="button"
                      onClick={removePhoto}
                      className="text-[10px] font-bold tracking-[0.08em] text-cream/80 uppercase underline-offset-4 transition hover:text-orange-brand hover:underline"
                    >
                      Remove
                    </button>
                  )}
                  <input
                    ref={photoInput}
                    type="file"
                    accept={AVATAR_TYPES.join(",")}
                    hidden
                    onChange={(event) => {
                      void choosePhoto(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </div>
                {photoStatus && (
                  <p role={photoStatus.tone === "fail" ? "alert" : undefined} className={`mt-1.5 text-xs ${photoStatus.tone === "fail" ? "text-orange-brand" : "text-cream/70"}`}>
                    {photoStatus.text}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="shrink-0 px-1 text-xl leading-none text-cream transition hover:text-orange-brand"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <section className="border-b-2 border-line px-5 py-4.5">
                <h2 className={heading}>Profile</h2>
                {form ? (
                  <div className="grid grid-cols-2 gap-3">
                    {field("firstName", "First name")}
                    {field("lastName", "Last name")}
                    <div className="col-span-2">{field("middleName", "Middle name", { placeholder: "—" })}</div>
                  </div>
                ) : (
                  <p className="text-[13px] text-ink-muted">{NO_PROFILE}</p>
                )}
                <div className="mt-3.5 grid grid-cols-2 gap-3">
                  {readOnly("Employee ID", account.employeeEid ?? profile?.employeeEid)}
                  {readOnly("Position", profile?.position)}
                  {readOnly("Team leader", org?.supervisorName)}
                  {readOnly("Manager", org?.managerName)}
                </div>
                <p className="mt-3 text-[11px] text-ink-faint">
                  Employee ID, position, team leader and manager come from the roster import — ask an administrator to change them.
                </p>
              </section>

              {form && (
                <>
                  <section className="border-b-2 border-line px-5 py-4.5">
                    <h2 className={heading}>Contact</h2>
                    <div className="flex flex-col gap-3">
                      {field("phoneNumber", "Phone number", { type: "tel", inputMode: "tel" })}
                      {field("addressLine1", "Address line 1")}
                      {field("addressLine2", "Address line 2", { placeholder: "Apt, suite, unit…" })}
                      <div className="grid grid-cols-2 gap-3">
                        {field("cityProvince", "City / province")}
                        {field("zipcode", "Zipcode", { inputMode: "numeric" })}
                      </div>
                      {field("country", "Country")}
                    </div>
                  </section>

                  <section className="border-b-2 border-line px-5 py-4.5">
                    <h2 className={heading}>Emergency contact</h2>
                    <div className="flex flex-col gap-3">
                      {field("emergencyContactName", "Name")}
                      <div className="grid grid-cols-2 gap-3">
                        {field("emergencyContactNumber", "Phone number", { type: "tel", inputMode: "tel" })}
                        {field("emergencyContactRelationship", "Relationship")}
                      </div>
                    </div>
                  </section>
                </>
              )}

              <section className="border-b-2 border-line px-5 py-4.5">
                <h2 className={heading}>Security</h2>
                <p className="mb-3 text-[13px] text-ink-muted">Password and the authenticator app are managed on their own page.</p>
                <Link href="/mfa" prefetch={false} onClick={close} className={linkButton}>
                  Manage security &amp; MFA <span aria-hidden>→</span>
                </Link>
              </section>

              {quickLinks.length > 0 && (
                <section className="px-5 py-4.5">
                  <h2 className={heading}>Quick links</h2>
                  <div className="flex flex-col gap-2.5">
                    {quickLinks.map((item) => (
                      <Link key={item.href} href={item.href} prefetch={false} onClick={close} className={linkButton}>
                        {item.label} <span aria-hidden>→</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t-2 border-ink bg-surface px-5 py-3.5">
              <p className="min-w-0 text-xs font-semibold" aria-live="polite">
                {error ? (
                  <span role="alert" className="text-fail">
                    {error}
                  </span>
                ) : confirmed ? (
                  <span className="text-pass">Saved</span>
                ) : dirty ? (
                  <span className="text-ink-muted">Unsaved changes</span>
                ) : null}
              </p>
              <div className="flex shrink-0 gap-2.5">
                <button type="button" onClick={close} className="btn-secondary px-4 py-2.5 text-[13px]">
                  Cancel
                </button>
                {form && (
                  <button type="button" onClick={save} disabled={saving || !dirty} className="btn-primary px-4 py-2.5 text-[13px]">
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
