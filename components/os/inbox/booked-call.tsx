// The booked call, as a chip: thread header and contact panel.
import { formatSlotShort } from "@/lib/os/integrations/calendar/slots";
import type { BookingStatusName } from "@/lib/os/setter/booking-store";

export interface BookedCall {
  start: string;
  /** The lead's timezone (what J quoted). */
  timezone: string;
  /** Kevin's: the chip shows his time. */
  hostTimezone: string;
  status: BookingStatusName;
  email: string;
}

const STATUS: Record<BookingStatusName, string> = {
  BOOKED: "awaiting screenshot",
  CONFIRMED: "confirmed",
  LINK_SENT: "link sent",
  CANCELLED: "cancelled",
};

export default function BookedCallChip({ booking }: { booking: BookedCall }) {
  return (
    <span className="os-booked" data-status={booking.status} title={`Invite to ${booking.email}. Shown in your time (${booking.hostTimezone}).`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      </svg>
      Call {formatSlotShort(booking.start, booking.hostTimezone)} · {STATUS[booking.status]}
    </span>
  );
}
