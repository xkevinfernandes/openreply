// Loading shapes for the Inbox and Contacts while their data streams in.
// Same boxes as the real panes, so nothing jumps when they arrive.

const Bar = ({ w, h = 10 }: { w: number | string; h?: number }) => <span className="os-skel" style={{ width: w, height: h }} />;

export function ThreadListSkeleton({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="os-ix-rail" aria-busy="true" aria-label="Loading threads">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="os-skel os-skel-round" style={{ width: 32, height: 32 }} />
        ))}
      </div>
    );
  }
  return (
    <section className="os-ix-list" aria-busy="true" aria-label="Loading threads">
      <div className="os-ix-list-head">
        <div className="os-ix-title">
          <h1>Inbox</h1>
        </div>
        <Bar w="100%" h={32} />
      </div>
      <ul className="os-ix-rows os-skel-rows">
        {Array.from({ length: 9 }, (_, i) => (
          <li key={i} className="os-skel-row">
            <span className="os-skel os-skel-round" style={{ width: 36, height: 36 }} />
            <span className="os-skel-lines">
              <Bar w={`${50 + ((i * 17) % 35)}%`} />
              <Bar w={`${70 + ((i * 11) % 25)}%`} h={8} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConversationSkeleton() {
  const rows = [
    { mine: false, w: 52 },
    { mine: true, w: 64 },
    { mine: true, w: 40 },
    { mine: false, w: 58 },
    { mine: true, w: 70 },
  ];
  return (
    <section className="os-ix-conv" aria-busy="true" aria-label="Loading conversation">
      <div className="os-skel-head">
        <span className="os-skel os-skel-round" style={{ width: 32, height: 32 }} />
        <Bar w={140} h={12} />
      </div>
      <div className="os-skel-thread">
        {rows.map((r, i) => (
          <span key={i} className="os-skel os-skel-bubble" data-mine={r.mine || undefined} style={{ width: `${r.w}%` }} />
        ))}
      </div>
    </section>
  );
}

export function PanelSkeleton({ className = "os-ix-panel" }: { className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading contact">
      <div className="os-skel-panel">
        <div className="os-skel-head">
          <span className="os-skel os-skel-round" style={{ width: 40, height: 40 }} />
          <span className="os-skel-lines">
            <Bar w={120} h={12} />
            <Bar w={80} h={8} />
          </span>
        </div>
        <Bar w={110} h={28} />
        <Bar w="100%" h={1} />
        {Array.from({ length: 5 }, (_, i) => (
          <Bar key={i} w={`${60 + ((i * 13) % 35)}%`} />
        ))}
      </div>
    </div>
  );
}

export function ContactsSkeleton() {
  return (
    <div className="os-cx" aria-busy="true" aria-label="Loading contacts">
      <section className="os-cx-main">
        <header className="os-cx-head">
          <h1>Contacts</h1>
        </header>
        <div className="os-cx-chips">
          <Bar w={110} h={28} />
          <Bar w={110} h={28} />
          <Bar w={120} h={28} />
        </div>
        <div className="os-skel-board">
          {Array.from({ length: 5 }, (_, c) => (
            <div key={c} className="os-skel-col">
              <Bar w={90} h={12} />
              {Array.from({ length: 4 - (c % 3) }, (_, i) => (
                <span key={i} className="os-skel" style={{ width: "100%", height: 68, borderRadius: 10 }} />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
