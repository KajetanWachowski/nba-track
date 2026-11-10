/** Sync finished games and settle logged predictions (results, closing prices, CLV). */
import { settlePredictions } from "../lib/tracking";

console.log(await settlePredictions());
