import { getDb } from './db.js';
import { isFreeModelId } from '../shared/types.js';

/**
 * Fallback commercial baseline (USD per 1M tokens) used only when the router has
 * no discovered pricing for a model. This intentionally mirrors a mid-tier paid
 * frontier model so the "avoided cost" figure is conservative, not inflated.
 */
const FALLBACK_INPUT_PER_M = 3.0;
const FALLBACK_OUTPUT_PER_M = 15.0;

interface Pricing {
  inputPerM: number;
  outputPerM: number;
}

function lookupPricing(modelId: string): Pricing | null {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT pricing_input, pricing_output FROM models
      WHERE LOWER(model_id) = LOWER(?) AND pricing_input IS NOT NULL
      ORDER BY last_discovered_at DESC LIMIT 1
    `).get(modelId) as any;
    if (row && (row.pricing_input != null || row.pricing_output != null)) {
      return {
        inputPerM: row.pricing_input ?? FALLBACK_INPUT_PER_M,
        outputPerM: row.pricing_output ?? FALLBACK_OUTPUT_PER_M,
      };
    }
  } catch {}
  return null;
}

/**
 * Computes the USD cost avoided by serving a request from a zero-cost model
 * (or from the local cache) instead of a comparable paid model.
 *
 * Returns 0 for requests that were served by a paid model, since nothing was avoided.
 */
export function calculateMoneySaved(
  modelId: string,
  promptTokens: number = 0,
  completionTokens: number = 0,
  isCached: boolean = false
): number {
  // Only free models or cache hits represent avoided spend.
  const free = isFreeModelId(modelId) || isCached;
  if (!free) return 0;

  const pricing = lookupPricing(modelId) || {
    inputPerM: FALLBACK_INPUT_PER_M,
    outputPerM: FALLBACK_OUTPUT_PER_M,
  };

  const inputCost = (Math.max(0, promptTokens) / 1_000_000) * pricing.inputPerM;
  const outputCost = (Math.max(0, completionTokens) / 1_000_000) * pricing.outputPerM;

  return Number((inputCost + outputCost).toFixed(6));
}

export function getSavingsStats(): { totalSavedUsd: number; totalTokensSaved: number; totalRequestsSaved: number } {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(money_saved_usd), 0) as totalSaved,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COUNT(*) as totalRequests
      FROM request_logs
      WHERE money_saved_usd > 0 OR cached = 1
    `).get() as any;

    return {
      totalSavedUsd: Number((row?.totalSaved || 0).toFixed(4)),
      totalTokensSaved: Number(row?.totalTokens || 0),
      totalRequestsSaved: Number(row?.totalRequests || 0),
    };
  } catch {
    return { totalSavedUsd: 0, totalTokensSaved: 0, totalRequestsSaved: 0 };
  }
}