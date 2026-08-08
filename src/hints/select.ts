import type { HintSelector } from "../domain/scenarios/index.js";
import type {
  HintResponse,
  HintSelectionRequest,
  HintTarget,
} from "./model.js";
import { freezeDeep } from "./model.js";

const releaseName = (branch: string): "acceptance" | "production" =>
  branch.includes("production") ? "production" : "acceptance";
const matches = (selector: HintSelector, target: HintTarget): boolean =>
  "check" in selector
    ? selector.check === target.check
    : "ticket" in selector
      ? selector.ticket === target.ticket
      : "category" in selector
        ? selector.category === target.category
        : selector.release === target.release;
const rank = (selector: HintSelector): number =>
  "check" in selector
    ? 4
    : "ticket" in selector
      ? 3
      : "category" in selector
        ? 2
        : 1;

export const selectHint = (request: HintSelectionRequest): HintResponse => {
  if (request.report?.verdict === "pass")
    return freezeDeep({ state: "solved", nextTier: request.nextTier });
  if (request.nextTier > request.scenario.hints.length)
    return freezeDeep({ state: "exhausted", nextTier: request.nextTier });
  const tier = request.scenario.hints[request.nextTier - 1];
  if (!tier)
    return freezeDeep({ state: "exhausted", nextTier: request.nextTier });
  let target: HintTarget | null = null;
  if (request.report) {
    for (const group of request.report.groups) {
      const check = group.checks.find(({ status }) => status !== "pass");
      if (!check) continue;
      target = {
        release: releaseName(request.report.release.branch),
        category: group.category,
        check: check.id,
        ticket: request.report.release.tickets[0] ?? null,
      };
      break;
    }
  }
  const selectedTarget = target;
  const variant = selectedTarget
    ? tier.variants
        .filter(({ selector }) => matches(selector, selectedTarget))
        .sort((a, b) => rank(b.selector) - rank(a.selector))[0]
    : undefined;
  return freezeDeep({
    state: "hint",
    tier: tier.tier,
    name: tier.name,
    target,
    text: variant?.text ?? tier.fallback,
    nextTier: request.nextTier + 1,
  });
};
