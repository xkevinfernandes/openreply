interface PageHeadProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHead({ eyebrow, title, description, actions }: PageHeadProps) {
  return (
    <header className="os-head">
      <div>
        {eyebrow && <div className="os-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions}
    </header>
  );
}

/** Placeholder for a section that a later build step fills in. */
export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="os-empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
