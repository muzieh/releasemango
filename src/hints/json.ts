import type { HintResponse } from "./model.js";
export const renderHintJson = (response: HintResponse): string => {
  const value =
    response.state === "hint"
      ? {
          schemaVersion: 1,
          state: response.state,
          tier: response.tier,
          name: response.name,
          target: response.target,
          text: response.text,
          nextTier: response.nextTier,
        }
      : {
          schemaVersion: 1,
          state: response.state,
          nextTier: response.nextTier,
        };
  return `${JSON.stringify(value)}\n`;
};
