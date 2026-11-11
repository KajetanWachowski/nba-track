import { isPolishBook } from "./books";

export interface PricedOffer {
  book: string;
  dec: number;
}

/**
 * Which price a Polish bettor can actually take:
 *   1. Superbet (main source)  2. best other Polish book  3. none → US price is reference only.
 * `eff` maps an offer to its effective price (e.g. after the optional stake tax).
 */
export function choosePrice<T extends PricedOffer>(offers: T[], eff: (o: T) => number = (o) => o.dec) {
  const pl = offers.filter((o) => isPolishBook(o.book)).sort((a, b) => eff(b) - eff(a));
  const superbet = pl.find((o) => o.book === "superbet") ?? null;
  const bestPl = pl[0] ?? null;
  const used = superbet ?? bestPl;
  const reference = offers.filter((o) => !isPolishBook(o.book)).sort((a, b) => eff(b) - eff(a))[0] ?? null;
  return { superbet, bestPl, used, reference, playable: Boolean(used), priceOffer: used ?? reference };
}
