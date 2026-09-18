import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employees, userAvatars } from "@/lib/db/schema";
import { podiumEnabled } from "@/lib/podium/gate";
import { podiumPhotoIds } from "@/lib/queries/top-performers";
import { monthStartOf, todayInManila } from "@/lib/scorecard/review";

/**
 * A profile picture for someone standing on this month's podium.
 *
 * Everywhere else in this app a profile picture is served to its owner and
 * nobody else (see the profile avatar route, which says so). This is the
 * one deliberate exception, and it is drawn as narrowly as the exception
 * allows:
 *
 * - only to a signed-in, active account;
 * - only for an employee who is on the podium *right now*, checked against
 *   the same cached computation the page renders from rather than against
 *   anything in the URL. Six people this month, and the moment a new
 *   import moves somebody off the podium their picture stops being served
 *   here;
 * - only while the podium itself is switched on.
 *
 * So the id in the path is not a capability. Asking for anyone else's is a
 * 404, and so is asking for a podium member who has no picture — the page
 * knows which is which before it asks (`photoVersion`) and draws the
 * illustrated fallback instead of making a request that could only fail.
 *
 * Cacheable for good because the page appends the picture's own timestamp
 * as `?v=`: a new upload is a new URL. Private, because whose face this is
 * depends on who is on the podium, and a shared cache must not answer for
 * the next month's.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Not allowed", { status: 403 });
  if (!podiumEnabled()) return new Response("Not found", { status: 404 });

  const { employeeId } = await params;
  const allowed = await podiumPhotoIds(monthStartOf(todayInManila()));
  if (!allowed.has(employeeId)) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const [row] = await db
    .select({ contentType: userAvatars.contentType, image: userAvatars.image })
    .from(employees)
    .innerJoin(userAvatars, eq(userAvatars.userId, employees.userId))
    .where(eq(employees.id, employeeId))
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
