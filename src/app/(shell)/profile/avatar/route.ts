import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { userAvatars } from "@/lib/db/schema";

/**
 * The signed-in person's own profile picture. The header links to it with
 * the row's timestamp as `?v=`, so the response can be cached for good:
 * a new upload is a new URL. Nobody else's picture is served here.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Not allowed", { status: 403 });

  const [row] = await db
    .select({ contentType: userAvatars.contentType, image: userAvatars.image })
    .from(userAvatars)
    .where(eq(userAvatars.userId, user.id))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  return new Response(Buffer.from(row.image, "base64"), {
    headers: {
      "Content-Type": row.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
