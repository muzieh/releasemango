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
  const policy = request.scenario.releases.production;
  const find = (
    collection: typeof request.scenario.checks.required,
    id: string,
  ) => {
    const check = collection.find((candidate) => candidate.id === id);
    if (!check) throw new Error(`Release check '${id}' is unavailable.`);
    return check;
  };
  const scenario = Object.freeze({
    ...request.scenario,
    checks: Object.freeze({
      required: Object.freeze(
        policy.requiredChecks.map((id) =>
          find(request.scenario.checks.required, id),
        ),
      ),
      forbidden: Object.freeze(
        policy.forbiddenChecks.map((id) =>
          find(request.scenario.checks.forbidden, id),
        ),
      ),
    }),
  });
  const result = await evaluateBranch({
    ...request,
    scenario,
    branch: PRODUCTION_BRANCH,
    baseline: PRODUCTION_BASELINE,
  });

  return Object.freeze({
    ...result,
    branch: PRODUCTION_BRANCH,
    baseline: PRODUCTION_BASELINE,
    tickets: Object.freeze([...policy.tickets]),
  });
}
