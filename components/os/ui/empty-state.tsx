/** One line and maybe one action. No essays. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="os-empty-state">
      <p className="os-empty-state-title">{title}</p>
      {children ? <p className="os-empty-state-body">{children}</p> : null}
      {action ? <div className="os-empty-state-action">{action}</div> : null}
    </div>
  );
}
