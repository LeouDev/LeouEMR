/**
 * The one password rule the app applies on its own forms: length. Supabase
 * Auth enforces its own minimum and, when switched on, a leaked-password
 * check at the moment the password is set; this keeps the forms from
 * offering something the server will refuse, and asks for more than the
 * server's floor because a team's performance records deserve it.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** What the form asks for, in one line, matching Supabase's "letters and digits" requirement. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, with a letter and a digit`;

export function passwordProblem(password: string, confirmation?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    return `${PASSWORD_HINT}. A short phrase with a number in it works well.`;
  }
  if (confirmation !== undefined && confirmation !== password) return "The two passwords do not match.";
  return null;
}
