# Email templates

Three branded bodies in one layout. Two are pasted into Supabase and sent by
it; the third is sent by this app and needs nothing pasted anywhere.

## Sent by Supabase

Paste-ready bodies for Supabase, Authentication, Emails. Both are the same
branded, table-based, inline-styled layout (survives Gmail, Outlook and
Apple Mail) and both link to the app's own confirmation route with a token
hash rather than Supabase's `{{ .ConfirmationURL }}`, so the link works
from any device, not only the one the request was made on.

| Template in Supabase | File | Link type |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `type=signup`, lands on /pending for an administrator's approval |
| Reset password | `reset-password.html` | `type=recovery`, lands on /reset-password |

Both footers already carry the postal address, so they are ready to paste
as they stand. Suggested subjects: "Confirm your Leou EMR account"
and "Choose a new Leou EMR password". The "expires after an hour" line
matches Supabase's default email link expiry; change both if that setting
is changed.

## Sent by the app

`welcome-approved.html` goes out when an administrator approves a pending
account. Supabase cannot send it — there is no auth event for "an
administrator approved this person" — so it is sent from
`approvePendingUsers` and `updateUser` in `src/app/(shell)/users/actions.ts`
through the same SMTP relay as the end-of-day report.

Do not paste this one anywhere. The copy here is the one a human edits;
`src/lib/mail/welcome-approved-template.ts` holds the identical string the
app actually sends, because `docs/` is not bundled into the deployed
function. `welcome-email.test.ts` fails if the two drift, so edit this file
and regenerate the module, or edit both together.

Its `{{ .Field }}` markers are filled by `renderWelcomeEmail`, not by
Supabase: `.FirstName` (derived from the account name, "Last, First"
included), `.Role` (the sidebar's label for it), `.Email`, `.SiteURL`
(`APP_URL`, else the request's host), `.HelpURL` (`HELP_URL`, else the app
itself — where it should point until there is a separate help site) and
`.SupportEmail` (`SUPPORT_EMAIL`, else `leou.comendador@optum.com`).
The footer's address comes from `MAIL_POSTAL_ADDRESS`, defaulting to the
Cebu IT Park office — which is why this one file keeps the
`[company address goes here]` marker where the other two have the address
written in: the app fills it at send time, so it must stay a marker here.
