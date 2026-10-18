// One fetch wrapper for the calendar APIs: timeouts, no-store, and errors
// mapped to a CalendarApiError code. The response body is only read to tell
// "slot taken" from other refusals; it never ends up in a message.
import { CalendarApiError, type CalendarErrorCode, type CalendarProviderId } from "./types";

export interface CalRequest {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  /** Context for the error mapping: a refusal on a booking call is often "taken". */
  booking?: boolean;
}

const TAKEN = /(no longer available|not available|unavailable|already (has|have) (a )?booking|already booked|no_available_users|slot|taken|start_time)/i;
const PLAN = /(plan|upgrade|paid|subscription)/i;

function classify(status: number, text: string, booking: boolean): CalendarErrorCode {
  if (status === 401) return "auth";
  if (status === 403) return booking || PLAN.test(text) ? "plan" : "scope";
  if (status === 409) return "slot_taken";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  if (booking && (status === 400 || status === 404 || status === 422) && TAKEN.test(text)) return "slot_taken";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "bad_request";
  return "unknown";
}

export async function calFetch<T>(provider: CalendarProviderId, url: string, init: CalRequest = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new CalendarApiError(provider, 502, "unavailable");
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CalendarApiError(provider, response.status, classify(response.status, text, Boolean(init.booking)));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => ({}))) as T;
}
