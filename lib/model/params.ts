import { getMeta } from "../db";
import { DEFAULT_PARAMS, type ModelParams } from "./player";

/** Live model parameters: defaults, overridden by values tuned on backtest training dates. */
export function getModelParams(): ModelParams {
  return { ...DEFAULT_PARAMS, ...(getMeta<Partial<ModelParams>>("modelParams") ?? {}) };
}
