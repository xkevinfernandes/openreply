import FollowupsScreen from "@/components/os/followups/followups-screen";
import { AttendanceRow, QueueRow, TaskCard } from "@/components/os/followups/sequence-queue";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadFollowups } from "@/lib/os/followups-data";
import { loadFollowupScreen, type FollowupScreen } from "@/lib/os/sequences/view";

const GROUP_TITLE = { no_reply: "Gone quiet", booked: "Before the call", after_call: "After the call" } as const;

function Sequences({ data, now }: { data: FollowupScreen; now: number }) {
  const groups = (["booked", "after_call", "no_reply"] as const).map((g) => ({ g, rows: data.queue.filter((q) => q.group === g) }));
  const ready = data.queue.filter((q) => q.status === "DRAFTED" || new Date(q.dueAt).getTime() <= now).length;
  return (
    <div className="os-fu">
      {(data.tasks.length > 0 || data.attendance.length > 0) && (
        <section className="os-fu-section" aria-labelledby="fu-yours">
          <header className="os-fu-section-head">
            <h2 id="fu-yours">Yours to do</h2>
            <span className="os-fu-count">{data.tasks.length + data.attendance.length} open</span>
          </header>
          <p className="os-fu-lede">Calls that are over: mark who showed. Anyone who did gets a personal voice note from you, never from J.</p>
          <ul className="os-fu-list">
            {data.attendance.map((a) => (
              <li key={a.bookingId} className="os-fu-row">
                <AttendanceRow a={a} now={now} />
              </li>
            ))}
            {data.tasks.map((t) => (
              <li key={t.id} className="os-fu-row">
                <TaskCard t={t} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="os-fu-section" aria-labelledby="fu-queued">
        <header className="os-fu-section-head">
          <h2 id="fu-queued">Queued follow-ups</h2>
          <span className="os-fu-count">{data.queue.length ? `${data.queue.length} queued${ready ? ` · ${ready} ready or due` : ""}` : "Nothing queued"}</span>
        </header>
        <p className="os-fu-lede">One step per person at a time. Each one becomes a J draft at its time and waits for your approve. A reply stops it.</p>
        {data.queue.length === 0 ? (
          <div className="os-fu-empty">No follow-ups queued. Sequences are set per setter in Knowledge bases → Follow-ups.</div>
        ) : (
          groups
            .filter((x) => x.rows.length)
            .map(({ g, rows }) => (
              <div key={g} className="os-seq-group">
                <h3 className="os-seq-group-title">{GROUP_TITLE[g]}</h3>
                <ul className="os-fu-list">
                  {rows.map((q) => (
                    <li key={q.stepId} className="os-fu-row">
                      <QueueRow q={q} now={now} />
                    </li>
                  ))}
                </ul>
              </div>
            ))
        )}
      </section>
    </div>
  );
}

export default async function FollowupsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const now = new Date();
  let seq: FollowupScreen | undefined;
  try {
    seq = await loadFollowupScreen(workspaceId, now);
  } catch (err) {
    console.error("[OS Follow-ups] sequences failed:", err);
  }
  let data;
  try {
    data = await loadFollowups(workspaceId, now);
  } catch (err) {
    console.error("[OS Follow-ups] load failed:", err);
  }

  return (
    <>
      <PageHead title="Follow-ups" description="J's follow-up sequences, the calls to mark, and the Friday resource sends. Nothing goes out until you press send." />
      {seq ? <Sequences data={seq} now={now.getTime()} /> : <div className="os-banner">The follow-up queue didn&apos;t load. Refresh in a minute.</div>}
      {data ? <FollowupsScreen data={data} now={now.getTime()} /> : <div className="os-banner">Follow-ups didn&apos;t load. Refresh in a minute.</div>}
    </>
  );
}
