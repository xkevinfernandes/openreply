"use client";

// Details tab. Wave-0 stub showing the key fields and keywords; owner: S3
// (fields n/m with inline edit, sync state, Kit tags, lead magnets sent).
import { PanelFields, PanelKeywords } from "@/components/os/contact-panel/sections";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";

export default function DetailsTab({ data }: { data: ContactPanelData }) {
  return (
    <>
      <PanelFields data={data} />
      <PanelKeywords data={data} />
    </>
  );
}
