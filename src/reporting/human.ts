import type { CoachingReport } from "./model.js";

export const renderHumanReport = (report: CoachingReport): string => {
  const lines = [
    `Release: ${report.release.branch} (${report.release.baseline})`,
    `Tickets: ${report.release.tickets.join(", ") || "none"}`,
    `Verdict: ${report.verdict}`,
    `Severity: ${report.severity}`,
    `Score: ${report.score === null ? "unavailable" : `${String(report.score)}/100`}`,
  ];
  for (const group of report.groups) {
    lines.push(group.category);
    for (const check of group.checks) {
      const summary = check.evidence.summary
        ? ` — ${check.evidence.summary}`
        : "";
      lines.push(`  ${check.id}: ${check.status}${summary}`);
    }
  }
  if (report.nextAction) lines.push(`Next action: ${report.nextAction}`);
  return `${lines.join("\n")}\n`;
};
