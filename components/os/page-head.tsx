import Link from "next/link";
import { PageHeader } from "@claudepreneur/brand/react";

interface PageHeadProps {
  title: React.ReactNode;
  /** The muted line under the h1. */
  description?: React.ReactNode;
  /** Right of the h1 (38px, secondary → primary → ⋯); under the subtitle on a phone. */
  actions?: React.ReactNode;
  /** Status beside the h1: a count, a pill, an info tip. */
  meta?: React.ReactNode;
  /** A way back above the title: { href, label }. */
  back?: { href: string; label: string };
  className?: string;
}

/**
 * Every DM OS page title: the brand PageHeader in its v0.7 layout (actions on
 * the h1's row, status in meta, a back link above). The space under it is the
 * page's own gap (--card-gap = --head-gap) or .os-page-head's margin.
 */
export function PageHead({ title, description, actions, meta, back, className }: PageHeadProps) {
  return (
    <PageHeader
      className={className ? `os-page-head ${className}` : "os-page-head"}
      title={title}
      subtitle={description}
      actions={actions}
      meta={meta}
      back={
        back ? (
          <Link className="cp-back" href={back.href}>
            {back.label}
          </Link>
        ) : undefined
      }
      alignActions
    />
  );
}
