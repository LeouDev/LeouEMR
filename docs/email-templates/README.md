# Supabase Auth email templates

Paste-ready bodies for Supabase, Authentication, Emails. Both are the same
branded, table-based, inline-styled layout (survives Gmail, Outlook and
Apple Mail) and both link to the app's own confirmation route with a token
hash rather than Supabase's `{{ .ConfirmationURL }}`, so the link works
from any device, not only the one the request was made on.

| Template in Supabase | File | Link type |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `type=signup`, lands on /pending for an administrator's approval |
| Reset password | `reset-password.html` | `type=recovery`, lands on /reset-password |

Before pasting, replace `[company address goes here]` in the footer with
the real postal address. Suggested subjects: "Confirm your Leou EMR account"
and "Choose a new Leou EMR password". The "expires after an hour" line
matches Supabase's default email link expiry; change both if that setting
is changed.
