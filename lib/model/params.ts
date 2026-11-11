import { getMeta } from "../db";
import { DEFAULT_PARAMS, type ModelParams } from "./player";

/** Live model parameters: defaults, overridden by values tuned on backtest training dates. */
export function getModelParams(): ModelParams {
  const stored = getMeta<Partial<ModelParams>>("modelParams") ?? {};
  // parametry zapisane przed dodaniem korekty roli: przyjmij nowe ustawienia priora i formy (wybrane w backteście)
  const upgrade: Partial<ModelParams> = stored.roleShrink === undefined ? { priorStrength: 75, rateHalfLife: 22, roleShrink: 0.3 } : {};
  return { ...DEFAULT_PARAMS, ...stored, ...upgrade };
}
