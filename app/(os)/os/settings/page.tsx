import { ComingSoon, PageHead } from "@/components/os/page-head";

export default function Page() {
  return (
    <>
      <PageHead title="Settings" description="Instagram connection, DM logs and system health." />
      <ComingSoon title="Coming soon">Until then, use Settings, DM Logs and Diagnostics in the old dashboard.</ComingSoon>
    </>
  );
}
