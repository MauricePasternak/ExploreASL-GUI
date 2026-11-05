import type { KappaResult } from "./interRaterAgreement";

export interface CsvVerdict {
  status: "pass" | "fail";
  reason?: string;
  notes?: string;
}

export interface CsvReviewer {
  id: string;
  label: string;
}

export interface CsvQcMetrics {
  coverage?: number | null;
  spatialCov?: number | null;
  motion?: readonly number[] | null;
  motionExclusionPct?: number | null;
}

export interface AgreementGroupCsvRow {
  group: string;
  result: KappaResult;
}

export interface AgreementCsvPayload {
  numberOfReviewers: number;
  overall: KappaResult;
  numberOfDisagreements: number;
  perGroup: readonly AgreementGroupCsvRow[];
}

export interface VerdictsCsvPayload {
  /** Registry order determines reviewer column order. Two or more reviewers enable multi mode. */
  reviewers: readonly CsvReviewer[];
  /** Inventory order controls verdict data row order. */
  subjectSessions: readonly string[];
  verdicts: Record<string, Record<string, CsvVerdict>>;
  resolvedVerdicts?: Record<string, CsvVerdict>;
  qcMetrics?: Record<string, CsvQcMetrics | undefined>;
  agreement?: AgreementCsvPayload;
}

type CsvValue = string | number | null | undefined;

const QC_HEADERS = ["Coverage_Pct", "SpatialCoV", "Motion_mm", "Motion_Exclusion_Pct"];

export function escapeCsvField(value: string): string {
  const normalized = value.replace(/\r\n?|\n/g, "\n");
  const protectedValue = /^[=+\-@]/.test(normalized) ? `\t${normalized}` : normalized;

  return /[",\n]/.test(protectedValue) ? `"${protectedValue.replace(/"/g, '""')}"` : protectedValue;
}

function csvRow(values: readonly CsvValue[]): string {
  return values
    .map((value) => {
      if (value === null || value === undefined) return "";
      return typeof value === "number" ? finiteNumber(value) : escapeCsvField(value);
    })
    .join(",");
}

function finiteNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function valueOrBlank(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : finiteNumber(value);
}

function motionMaximum(motion: readonly number[] | null | undefined): string {
  if (!motion || motion.length === 0) return "";
  const maximum = Math.max(...motion);
  return finiteNumber(maximum);
}

function qcValues(metrics: CsvQcMetrics | undefined): string[] {
  return [
    valueOrBlank(metrics?.coverage),
    valueOrBlank(metrics?.spatialCov),
    motionMaximum(metrics?.motion),
    valueOrBlank(metrics?.motionExclusionPct),
  ];
}

function unanimousStatus(
  subjectSession: string,
  reviewers: readonly CsvReviewer[],
  verdicts: Record<string, Record<string, CsvVerdict>>,
): CsvVerdict["status"] | undefined {
  const statuses = reviewers.map((reviewer) => verdicts[reviewer.id]?.[subjectSession]?.status);
  if (statuses.some((status) => status === undefined)) return undefined;
  return statuses.every((status) => status === statuses[0]) ? statuses[0] : undefined;
}

export function generateAgreementCsv(payload: AgreementCsvPayload): string {
  const { overall } = payload;
  const lines = [
    csvRow(["Agreement Statistics"]),
    csvRow(["Metric", "Value"]),
    csvRow(["Number_of_Reviewers", payload.numberOfReviewers]),
    csvRow(["Overall_Initial_Agreement_Rate", overall.agreementRate]),
    csvRow(["Kappa", overall.kappa]),
    csvRow(["Kappa_CI_Lower", overall.ci95Lower]),
    csvRow(["Kappa_CI_Upper", overall.ci95Upper]),
    csvRow(["N_SubjectSessions", overall.n]),
    csvRow(["N_SubjectSessions_Requiring_Resolution", payload.numberOfDisagreements]),
    "",
    csvRow(["Per_Group_Agreement"]),
    csvRow([
      "Group",
      "N_SubjectSessions",
      "Initial_Agreement_Rate",
      "Kappa",
      "Kappa_CI_Lower",
      "Kappa_CI_Upper",
    ]),
  ];

  for (const { group, result } of payload.perGroup) {
    lines.push(
      csvRow([
        group,
        result.n,
        result.agreementRate,
        result.kappa,
        result.ci95Lower,
        result.ci95Upper,
      ]),
    );
  }

  return lines.join("\n");
}

export function generateVerdictsCsv(payload: VerdictsCsvPayload): string {
  const reviewers = payload.reviewers;
  const multiReviewerMode = reviewers.length >= 2;
  if (multiReviewerMode && !payload.agreement)
    throw new Error("Multi-reviewer CSV requires prepared agreement statistics");
  const rows: string[] = [];

  if (!multiReviewerMode) {
    rows.push(csvRow(["SubjectSession", "Verdict", "Reason", "Notes", ...QC_HEADERS]));
    const verdicts = payload.verdicts[reviewers[0]?.id] ?? {};
    for (const subjectSession of payload.subjectSessions) {
      const verdict = verdicts[subjectSession];
      rows.push(
        csvRow([
          subjectSession,
          verdict?.status,
          verdict?.reason,
          verdict?.notes,
          ...qcValues(payload.qcMetrics?.[subjectSession]),
        ]),
      );
    }
    return rows.join("\n");
  }

  const header = ["SubjectSession"];
  reviewers.forEach((_reviewer, index) => {
    const reviewerNumber = index + 1;
    header.push(
      `Reviewer_${reviewerNumber}_Verdict`,
      `Reviewer_${reviewerNumber}_Reason`,
      `Reviewer_${reviewerNumber}_Notes`,
    );
  });
  header.push("Final_Verdict", "Resolution_Notes", ...QC_HEADERS);
  rows.push(csvRow(header));

  const verdicts = payload.verdicts;
  for (const subjectSession of payload.subjectSessions) {
    const resolution = payload.resolvedVerdicts?.[subjectSession];
    const reviewerValues = reviewers.flatMap((reviewer) => {
      const verdict = verdicts[reviewer.id]?.[subjectSession];
      return [verdict?.status, verdict?.reason, verdict?.notes];
    });
    const finalVerdict = resolution?.status ?? unanimousStatus(subjectSession, reviewers, verdicts);
    rows.push(
      csvRow([
        subjectSession,
        ...reviewerValues,
        finalVerdict,
        resolution?.notes,
        ...qcValues(payload.qcMetrics?.[subjectSession]),
      ]),
    );
  }

  rows.push("", generateAgreementCsv(payload.agreement!));
  return rows.join("\n");
}
