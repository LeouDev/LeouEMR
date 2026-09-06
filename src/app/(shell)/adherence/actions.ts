"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { parseAdherencePdf, type AdherenceAgentDay } from "@/lib/adherence/parse-pdf";

const MAX_BYTES = 25 * 1024 * 1024;

export type AdherenceUploadResponse =
  | { ok: true; fileName: string; agents: AdherenceAgentDay[] }
  | { ok: false; error: string };

/**
 * Reads a NICE Workforce Management Adherence PDF export and returns each
 * agent's scheduled-vs-actual timeline. Nothing is written to the database —
 * this is a read-only aid for deciding what to code, not the system of
 * record for the coding itself.
 */
export async function parseAdherenceUpload(formData: FormData): Promise<AdherenceUploadResponse> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role === "agent") {
    return { ok: false, error: "Only team leads and above can use this tool" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a PDF to upload" };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "File is larger than 25 MB" };
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "Unsupported file type — export the Adherence report as a PDF" };
  }

  let agents: AdherenceAgentDay[];
  try {
    agents = await parseAdherencePdf(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    return { ok: false, error: `Could not read this PDF: ${(error as Error).message}` };
  }

  if (agents.length === 0) {
    return {
      ok: false,
      error: "No agent adherence rows were found in this PDF — is this an Adherence report export?",
    };
  }

  return { ok: true, fileName: file.name, agents };
}
