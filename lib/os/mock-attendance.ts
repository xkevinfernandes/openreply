// OS_MOCK=1: the sample's call outcomes, one source for every screen (Home,
// Pipeline, the All · funnel board, the contact panel's stage). The latest
// mock booking with an attendance wins (marking a call in the app changes
// it); otherwise the seeded outcome, which matches the follow-up sample's
// bookings (lib/os/sequences/mock-seed.ts): chris.makes missed his call,
// ava.creates came.

import { mockBookingRows } from "@/lib/os/setter/booking-store";

export type MockAttendance = "SHOWED" | "NO_SHOW";

export const SAMPLE_ATTENDANCE: Readonly<Record<string, MockAttendance>> = { c11: "NO_SHOW", c12: "SHOWED" };

export function mockAttendance(contactId: string): MockAttendance | null {
  const rows = [...mockBookingRows().values()].filter((b) => b.contactId === contactId && b.attendance);
  const last = rows[rows.length - 1]?.attendance;
  return (last as MockAttendance | undefined) ?? SAMPLE_ATTENDANCE[contactId] ?? null;
}
