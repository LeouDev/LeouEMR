import { Card, CardHeader } from "@/components/ui";
import { getRampProgression } from "@/lib/queries/ramp-progression";
import { requireRampUser, visibleTeamNames } from "../access";
import { ProgressionBoard } from "../progression-board";
import { RampBand, RampTabs } from "../ramp-tabs";

const DOWNLOAD =
  "border-2 border-ink px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-orange-brand hover:text-orange-brand";

/**
 * How every cohort actually progressed, stage by stage.
 *
 * Its own route rather than a second card under the board, so a reader
 * working in one is not scrolling past the other — and so that opening the
 * board to set a start date does not run this, which is the heaviest read
 * in the app.
 *
 * Organisation-wide and cached, then narrowed to the reader's scope here:
 * the progression is one answer for everybody, and computing it per viewer
 * is what the cache exists to prevent (see lib/queries/ramp-progression.ts).
 */
export default async function RampProgressionPage() {
  const user = await requireRampUser();
  const [everyTeam, visible] = await Promise.all([getRampProgression(), visibleTeamNames(user)]);
  const teams = everyTeam.filter((team) => visible.has(team.supervisor));

  return (
    <>
      <RampBand />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <RampTabs active="progression" />

        <Card>
          <CardHeader
            title="Progression by stage"
            subtitle="Every ramp on record, averaged per team — open a team for its agents, then a figure for what the supervisor wrote"
            action={
              teams.length > 0 ? (
                <span className="flex items-center gap-2">
                  {/* Plain links, not buttons: a download is a navigation, and
                      this way it works with a middle click and a right click
                      like every other file in the app. */}
                  <a href="/ramp/export" className={DOWNLOAD}>
                    CSV
                  </a>
                  <a href="/ramp/export?format=xlsx" className={DOWNLOAD}>
                    Excel
                  </a>
                </span>
              ) : undefined
            }
          />

          <ProgressionBoard teams={teams} />
        </Card>
      </main>
    </>
  );
}
