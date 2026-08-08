import type { CoachingReport } from "./model.js";

export interface ReportJsonV1 {
  readonly schemaVersion: 1;
  readonly release: CoachingReport["release"];
  readonly score: number | null;
  readonly verdict: CoachingReport["verdict"];
  readonly severity: CoachingReport["severity"];
  readonly groups: CoachingReport["groups"];
  readonly nextAction: string | null;
}

export const toReportJson = (report: CoachingReport): ReportJsonV1 => ({
  schemaVersion: 1,
  release: report.release,
  score: report.score,
  verdict: report.verdict,
  severity: report.severity,
  groups: report.groups,
  nextAction: report.nextAction,
});

export const serializeReportJson = (report: CoachingReport): string =>
  `${JSON.stringify(toReportJson(report))}\n`;
