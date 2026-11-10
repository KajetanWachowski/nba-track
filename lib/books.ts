/** Bookmaker catalogue and Polish betting-tax handling. */
import { getMeta, setMeta } from "./db";

export interface BookInfo {
  key: string;
  title: string;
  country: "pl" | "us" | "intl";
}

export const PL_BOOKS: BookInfo[] = [
  { key: "superbet", title: "Superbet", country: "pl" },
  { key: "betclic", title: "Betclic", country: "pl" },
  { key: "betfan", title: "Betfan", country: "pl" },
];

export const bookTitle = (key: string) => PL_BOOKS.find((b) => b.key === key)?.title ?? key;
export const isPolishBook = (key: string) => PL_BOOKS.some((b) => b.key === key.toLowerCase());

/**
 * Polish licensed bookmakers deduct a 12% turnover tax from the stake, so a price d pays as if it
 * were d × 0.88. Off by default (user's choice); can be enabled globally with per-book exceptions
 * for "tax-free" promotions.
 */
export interface TaxSettings {
  enabled: boolean;
  rate: number;
  exempt: string[]; // book keys whose promotion covers the tax
}

export const DEFAULT_TAX: TaxSettings = { enabled: false, rate: 0.12, exempt: [] };

export function getTaxSettings(): TaxSettings {
  return { ...DEFAULT_TAX, ...(getMeta<Partial<TaxSettings>>("plTax") ?? {}) };
}

export function saveTaxSettings(t: TaxSettings) {
  setMeta("plTax", t);
}

/** Effective decimal price after the stake tax, for Polish books when the tax setting is on. */
export function effectivePrice(book: string, dec: number, tax = getTaxSettings()): number {
  if (!tax.enabled || !isPolishBook(book) || tax.exempt.includes(book.toLowerCase())) return dec;
  return dec * (1 - tax.rate);
}
