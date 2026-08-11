import { cohensKappa, fleissKappa, type KappaResult } from "./interRaterAgreement";

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
  reviewers?: readonly CsvReviewer[];
  /** When supplied, this order controls verdict data row order. */
  subjectSessions?: readonly string[];
  verdicts: Record<string, CsvVerdict> | Record<string, Record<string, CsvVerdict>>;
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

function subjectSessions(payload: VerdictsCsvPayload, multiReviewerMode: boolean): string[] {
  if (payload.subjectSessions) return [...payload.subjectSessions];

  const keys = new Set<string>([
    ...Object.keys(payload.resolvedVerdicts ?? {}),
    ...Object.keys(payload.qcMetrics ?? {}),
  ]);
  if (multiReviewerMode) {
    for (const reviewerVerdicts of Object.values(
      payload.verdicts as Record<string, Record<string, CsvVerdict>>,
    )) {
      for (const subjectSession of Object.keys(reviewerVerdicts)) keys.add(subjectSession);
    }
  } else {
    for (const subjectSession of Object.keys(payload.verdicts)) keys.add(subjectSession);
  }

  return [...keys].sort();
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

function defaultAgreement(
  payload: VerdictsCsvPayload,
  reviewers: readonly CsvReviewer[],
  verdicts: Record<string, Record<string, CsvVerdict>>,
): AgreementCsvPayload {
  const reviewerStatuses: Record<string, Record<string, CsvVerdict["status"]>> = Object.fromEntries(
    reviewers.map((reviewer) => [
      reviewer.id,
      Object.fromEntries(
        Object.entries(verdicts[reviewer.id] ?? {}).map(([subjectSession, verdict]) => [
          subjectSession,
          verdict.status,
        ]),
      ),
    ]),
  );
  const overall =
    reviewers.length === 2
      ? cohensKappa(reviewerStatuses[reviewers[0].id], reviewerStatuses[reviewers[1].id])
      : fleissKappa(reviewerStatuses);
  const numberOfDisagreements = subjectSessions(payload, true).filter((subjectSession) => {
    const statuses = reviewers.map((reviewer) => verdicts[reviewer.id]?.[subjectSession]?.status);
    return (
      statuses.every((status) => status !== undefined) &&
      !statuses.every((status) => status === statuses[0])
    );
  }).length;

  return { numberOfReviewers: reviewers.length, overall, numberOfDisagreements, perGroup: [] };
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
    csvRow(["N_Subjects", overall.n]),
    csvRow(["N_Disagreements", payload.numberOfDisagreements]),
    "",
    csvRow(["Per_Group_Agreement"]),
    csvRow(["Group", "N", "Initial_Agreement_Rate", "Kappa", "Kappa_CI_Lower", "Kappa_CI_Upper"]),
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
  const reviewers = payload.reviewers ?? [];
  const multiReviewerMode = reviewers.length >= 2;
  const rows: string[] = [];

  if (!multiReviewerMode) {
    rows.push(csvRow(["SubjectSession", "Verdict", "Reason", "Notes", ...QC_HEADERS]));
    const verdicts = payload.verdicts as Record<string, CsvVerdict>;
    for (const subjectSession of subjectSessions(payload, false)) {
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

  const verdicts = payload.verdicts as Record<string, Record<string, CsvVerdict>>;
  for (const subjectSession of subjectSessions(payload, true)) {
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

  rows.push(
    "",
    generateAgreementCsv(payload.agreement ?? defaultAgreement(payload, reviewers, verdicts)),
  );
  return rows.join("\n");
}
