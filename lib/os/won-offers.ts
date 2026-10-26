// The Won picker's pure parts (dm-crm issue 013): a setter's structured offer
// list as picker rows, and the check on what Kevin picked or typed. The
// offers Markdown document is never parsed here; only Setter.offers (JSON).
// Client-safe: no database.

export interface PickerOffer {
  name: string;
  /** One short line under the name (length, or the first words of the pitch). */
  sub: string | null;
  /** The price in the workspace currency, when the offer has one. */
  price: number | null;
}

export interface WonPickerData {
  /** ISO 4217 (OsWorkspace.currency). */
  currency: string;
  /** Empty: the picker asks for a typed name and amount. */
  offers: PickerOffer[];
  /** The setter whose offers these are (shown as "From J's offers"). */
  setterName: string | null;
}

export interface WonChoice {
  offer: string;
  amount: number;
}

/** "€3,600", "3600", "$1.5k", "2.000 EUR" → a number; null when none. */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().replace(/\s/g, "");
  const m = s.match(/(\d[\d.,]*)(k)?/);
  if (!m) return null;
  let num = m[1];
  // "2.000" / "2,000" as thousands; "1.5" / "1,5" as decimals.
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, "");
  else num = num.replace(",", ".");
  const n = Number(num) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
}

/** Setter.offers JSON → picker rows. Closed or retired offers are left out. */
export function offersFromSetter(json: unknown): PickerOffer[] {
  if (!Array.isArray(json)) return [];
  const out: PickerOffer[] = [];
  for (const o of json) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    const status = typeof r.status === "string" ? r.status.toLowerCase() : "";
    if (["closed", "retired", "archived"].includes(status)) continue;
    const sub = typeof r.length === "string" && r.length.trim() ? r.length.trim() : typeof r.pitch === "string" && r.pitch.trim() ? r.pitch.trim().slice(0, 48) : null;
    out.push({ name, sub, price: parsePrice(r.price) });
  }
  return out;
}

export const OFFER_MAX = 80;
export const AMOUNT_MAX = 10_000_000;

/** What the picker sends, cleaned; or why it can't be saved. */
export function validateWonChoice(input: { offer?: unknown; amount?: unknown }): WonChoice | { error: string } {
  const offer = typeof input.offer === "string" ? input.offer.trim().replace(/\s+/g, " ") : "";
  if (!offer) return { error: "Pick or type the offer." };
  if (offer.length > OFFER_MAX) return { error: `Keep the offer under ${OFFER_MAX} characters.` };
  const amount = typeof input.amount === "number" ? input.amount : parsePrice(input.amount);
  if (amount === null || !Number.isFinite(amount) || amount < 0) return { error: "Type the amount." };
  if (amount > AMOUNT_MAX) return { error: "That amount looks too big." };
  return { offer, amount: Math.round(amount * 100) / 100 };
}
