import { EmptyState as CpEmptyState } from "@claudepreneur/brand/react";

/** One line and maybe one action. No essays. The shared EmptyState
 * (@claudepreneur/brand): in a card, left-aligned, title 17/600. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <CpEmptyState className="os-empty-state" title={title} description={children} actions={action} />;
}
