type Verdict = "pass" | "fail";

export const KAPPA_GUIDANCE =
  "Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject counts.";

export interface KappaResult {
  kappa: number | null;
  ci95Lower: number | null;
  ci95Upper: number | null;
  n: number;
  agreementRate: number;
}

const unavailableResult = (n: number, agreementRate: number): KappaResult => ({
  kappa: null,
  ci95Lower: null,
  ci95Upper: null,
  n,
  agreementRate,
});

const resultWithConfidenceInterval = (
  kappa: number,
  standardError: number,
  n: number,
  agreementRate: number,
): KappaResult => ({
  kappa,
  ci95Lower: kappa - 1.96 * standardError,
  ci95Upper: kappa + 1.96 * standardError,
  n,
  agreementRate,
});

export function cohensKappa(
  verdicts1: Record<string, Verdict>,
  verdicts2: Record<string, Verdict>,
): KappaResult {
  const subjectSessions = Object.keys(verdicts1).filter((subjectSession) =>
    Object.prototype.hasOwnProperty.call(verdicts2, subjectSession),
  );
  const n = subjectSessions.length;
  const agreements = subjectSessions.filter(
    (subjectSession) => verdicts1[subjectSession] === verdicts2[subjectSession],
  ).length;
  const agreementRate = n === 0 ? 0 : agreements / n;

  if (n < 2) return unavailableResult(n, agreementRate);

  const passCount1 = subjectSessions.filter(
    (subjectSession) => verdicts1[subjectSession] === "pass",
  ).length;
  const passCount2 = subjectSessions.filter(
    (subjectSession) => verdicts2[subjectSession] === "pass",
  ).length;
  const passProportion1 = passCount1 / n;
  const passProportion2 = passCount2 / n;
  const expectedAgreement =
    passProportion1 * passProportion2 + (1 - passProportion1) * (1 - passProportion2);
  const denominator = 1 - expectedAgreement;

  if (denominator === 0) return unavailableResult(n, agreementRate);
  if (agreementRate === 1) return { kappa: 1, ci95Lower: 1, ci95Upper: 1, n, agreementRate };

  const kappa = (agreementRate - expectedAgreement) / denominator;
  const standardError = Math.sqrt((agreementRate * (1 - agreementRate)) / (n * denominator ** 2));
  return resultWithConfidenceInterval(kappa, standardError, n, agreementRate);
}

export function fleissKappa(
  verdictsByReviewer: Record<string, Record<string, Verdict>>,
): KappaResult {
  const reviewerVerdicts = Object.values(verdictsByReviewer);
  const reviewers = reviewerVerdicts.length;
  if (reviewers <= 2) return unavailableResult(0, 0);

  const subjectSessions = Object.keys(reviewerVerdicts[0]).filter((subjectSession) =>
    reviewerVerdicts.every((verdicts) =>
      Object.prototype.hasOwnProperty.call(verdicts, subjectSession),
    ),
  );
  const n = subjectSessions.length;
  const ratings = subjectSessions.map((subjectSession) =>
    reviewerVerdicts.map((verdicts) => verdicts[subjectSession]),
  );
  const unanimousSubjects = ratings.filter((subjectRatings) =>
    subjectRatings.every((verdict) => verdict === subjectRatings[0]),
  ).length;
  const agreementRate = n === 0 ? 0 : unanimousSubjects / n;

  if (n < 2) return unavailableResult(n, agreementRate);

  const passCounts = ratings.map(
    (subjectRatings) => subjectRatings.filter((verdict) => verdict === "pass").length,
  );
  const totalPasses = passCounts.reduce((sum, passCount) => sum + passCount, 0);
  const totalRatings = n * reviewers;
  if (totalPasses === 0 || totalPasses === totalRatings) {
    return unavailableResult(n, agreementRate);
  }

  const meanPairAgreement =
    passCounts.reduce((sum, passCount) => {
      const failCount = reviewers - passCount;
      return sum + passCount * (passCount - 1) + failCount * (failCount - 1);
    }, 0) /
    (n * reviewers * (reviewers - 1));
  const passProportion = totalPasses / totalRatings;
  const expectedAgreement = passProportion ** 2 + (1 - passProportion) ** 2;
  const denominator = 1 - expectedAgreement;

  if (denominator === 0) return unavailableResult(n, agreementRate);
  if (meanPairAgreement === 1) {
    return { kappa: 1, ci95Lower: 1, ci95Upper: 1, n, agreementRate };
  }

  const kappa = (meanPairAgreement - expectedAgreement) / denominator;
  const variance =
    (2 * (expectedAgreement - expectedAgreement ** 2)) /
    (n * reviewers * (reviewers - 1) * denominator ** 2);
  return resultWithConfidenceInterval(kappa, Math.sqrt(variance), n, agreementRate);
}

export function formatKappa(
  kappa: number | null,
  ci95Lower: number | null,
  ci95Upper: number | null,
): string {
  if (
    kappa === null ||
    ci95Lower === null ||
    ci95Upper === null ||
    !Number.isFinite(kappa) ||
    !Number.isFinite(ci95Lower) ||
    !Number.isFinite(ci95Upper)
  ) {
    return "N/A";
  }

  return `${kappa.toFixed(2)} [${ci95Lower.toFixed(2)}, ${ci95Upper.toFixed(2)}]`;
}
