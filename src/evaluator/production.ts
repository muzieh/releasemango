import { evaluateBranch } from "./evaluate.js";
import type {
  ProductionEvaluationRequest,
  ProductionEvaluationResult,
} from "./model.js";

export const PRODUCTION_BRANCH = "release/production";
export const PRODUCTION_BASELINE = "refs/releasemango/baselines/production";

export async function evaluateProductionRelease(
  request: ProductionEvaluationRequest,
): Promise<ProductionEvaluationResult> {
  const result = await evaluateBranch({
    ...request,
    branch: PRODUCTION_BRANCH,
    baseline: PRODUCTION_BASELINE,
  });

  return Object.freeze({
    ...result,
    branch: PRODUCTION_BRANCH,
    baseline: PRODUCTION_BASELINE,
    tickets: Object.freeze([...request.scenario.releases.production.tickets]),
  });
}
