import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canUseMySpace, dayHeadline, workspaceLabel } from "@/lib/my-space/board";
import { getMySpace } from "@/lib/queries/my-space";
import { todayInManila } from "@/lib/scorecard/review";
import { MySpaceBoard } from "./my-space-board";

/**
 * My Space: a leader's own daily board — to dos, decisions, ideas and what
 * to let go of — saved as a dated snapshot at the end of the day. Every
 * role but the agent; private to the account, whatever the role's scope.
 */
export default async function MySpacePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (!canUseMySpace(user.role)) redirect("/dashboard");

  const today = todayInManila();
  const { board, days, note } = await getMySpace(user.id);

  return (
    <MySpaceBoard
      initialBoard={board}
      initialDays={days}
      initialNote={note}
      today={today}
      todayLabel={dayHeadline(today)}
      roleLabel={workspaceLabel(user.role)}
    />
  );
}
