import type { HintResponse } from "./model.js";
export const renderHintHuman = (response: HintResponse): string => {
  if (response.state === "solved") return "Exercise solved.\n";
  if (response.state === "exhausted") return "All hint tiers exhausted.\n";
  const target = response.target
    ? `\nTarget: ${response.target.release} / ${response.target.category} / ${response.target.check} / ${response.target.ticket ?? "none"}`
    : "";
  return `Hint ${String(response.tier)}/3 — ${response.name}${target}\n${response.text}\n`;
};
