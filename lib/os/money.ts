// Money in the workspace currency (OsWorkspace.currency). Pure, client-safe.

/** A won amount or offer price in the workspace currency, e.g. "€1,200". */
export function formatMoney(amount: number, currency: string, locale = "en-GB"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
