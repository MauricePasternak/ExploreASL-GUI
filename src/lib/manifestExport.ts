import { formatKappa, KAPPA_GUIDANCE } from "./interRaterAgreement";

export const QC_DENOMINATOR_NOTE =
  "Pass / Total counts reviewed subject-sessions (participant visits), not unique participants, excluding No Info. Metric n counts final-Pass subject-sessions with an available value for that metric.";

export interface ManifestPayload {
  metadataGroups: Array<{
    label: string;
    nParticipants: number;
    nSubjectSessions: number;
    nRuns: number;
    params: Record<string, string>;
  }>;
  versions: { exploreASL?: string; matlab?: string; gui?: string };
  qcGroups: Array<{
    label: string;
    passTotal: string;
    coverage: string;
    spatialCov: string;
    motion: string;
    motionExclusion: string;
    failReasons: string;
    agreementRate?: string;
  }>;
  agreement?: {
    numberOfReviewers: number;
    overall: {
      kappa: number | null;
      ci95Lower: number | null;
      ci95Upper: number | null;
      n: number;
      agreementRate: number;
    };
    numberOfDisagreements: number;
    perGroup: Array<{
      label: string;
      result: {
        kappa: number | null;
        ci95Lower: number | null;
        ci95Upper: number | null;
        n: number;
        agreementRate: number;
      };
    }>;
  };
  pipelineParagraph: string;
  methodsDisclaimer: string;
  methodsParagraphs: string[];
  methodsReferences: string[];
  dataPar?: Record<string, unknown>;
}

/** Redact machine paths, never selection expressions or inclusion identifiers. */
export function sanitiseDataParForExport(
  dataPar: Record<string, unknown>,
): Record<string, unknown> {
  function redact(value: unknown, key: string): unknown {
    if (key === "subjectRegexp" || key === "ForceInclusionList") return structuredClone(value);
    if (typeof value === "string") {
      const isPath =
        /(?:path|dir|folder|root)$/i.test(key) || /^(?:\/|[A-Za-z]:[\\/]|\\\\|~[\\/])/.test(value);
      if (!value || !isPath) return value;
      const name = value
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .slice(-1)[0];
      return name && !/^[A-Za-z]:$/.test(name) ? `[redacted path]/${name}` : "[redacted path]";
    }
    if (Array.isArray(value)) return value.map((entry) => redact(entry, key));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
    }
    return value;
  }
  return redact(dataPar, "") as Record<string, unknown>;
}

export function renderMarkdown(m: ManifestPayload): string {
  const lines: string[] = [];
  lines.push("# Project Manifest");
  lines.push("");

  lines.push("## Section 1: Study Parameters");
  lines.push("");
  for (const g of m.metadataGroups) {
    lines.push(`### ${g.label}`);
    lines.push("");
    lines.push("| Parameter | Value |");
    lines.push("|-----------|-------|");
    lines.push(`| N Participants | ${g.nParticipants} |`);
    lines.push(`| N Subject-Sessions | ${g.nSubjectSessions} |`);
    lines.push(`| N Total Runs | ${g.nRuns} |`);
    for (const [key, value] of Object.entries(g.params)) {
      lines.push(`| ${key} | ${value} |`);
    }
    lines.push("");
  }

  lines.push("## Section 2: Software Manifest");
  lines.push("");
  lines.push("| Software | Version |");
  lines.push("|----------|---------|");
  lines.push(`| ExploreASL | ${m.versions.exploreASL ?? "unknown"} |`);
  lines.push(`| ExploreASL GUI | ${m.versions.gui ?? "unknown"} |`);
  lines.push(`| MATLAB | ${m.versions.matlab ?? "unknown"} |`);
  lines.push("");

  if (m.dataPar && Object.keys(m.dataPar).length > 0) {
    lines.push("### ExploreASL Data Parameter Configuration");
    lines.push("");
    lines.push(
      "Machine-local paths are redacted. Subject selection and inclusion settings are preserved.",
    );
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(sanitiseDataParForExport(m.dataPar), null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push("## Section 3: QC Summary");
  lines.push("");
  lines.push(QC_DENOMINATOR_NOTE);
  lines.push("");
  for (const g of m.qcGroups) {
    lines.push(`### ${g.label}`);
    lines.push("");
    if (g.agreementRate === undefined) {
      lines.push("| Metric | Value |");
      lines.push("|--------|-------|");
      lines.push(`| Pass / Total (subject-sessions) | ${g.passTotal} |`);
      lines.push(`| Mean ASL Coverage % (SD) | ${g.coverage} |`);
      lines.push(`| Mean Spatial CoV % (SD) | ${g.spatialCov} |`);
      lines.push(`| Mean Motion (mm RMS) (SD) | ${g.motion} |`);
      lines.push(`| Mean Motion Exclusion % (SD) | ${g.motionExclusion} |`);
      lines.push(`| Fail Reasons | ${g.failReasons} |`);
    } else {
      lines.push("| Metric | Value | Initial Agreement Rate |");
      lines.push("|--------|-------|----------------|");
      lines.push(`| Pass / Total (subject-sessions) | ${g.passTotal} | ${g.agreementRate} |`);
      lines.push(`| Mean ASL Coverage % (SD) | ${g.coverage} | |`);
      lines.push(`| Mean Spatial CoV % (SD) | ${g.spatialCov} | |`);
      lines.push(`| Mean Motion (mm RMS) (SD) | ${g.motion} | |`);
      lines.push(`| Mean Motion Exclusion % (SD) | ${g.motionExclusion} | |`);
      lines.push(`| Fail Reasons | ${g.failReasons} | |`);
    }
    lines.push("");
  }

  if (m.agreement) {
    const { overall } = m.agreement;
    const agreed = Math.round(overall.agreementRate * overall.n);
    const kappa =
      overall.kappa === null
        ? "N/A"
        : `κ = ${formatKappa(overall.kappa, overall.ci95Lower, overall.ci95Upper)}`;
    lines.push("## Section 4: Inter-Rater Agreement");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Number of Reviewers | ${m.agreement.numberOfReviewers} |`);
    lines.push(
      `| Overall Initial Agreement Rate | ${Math.round(overall.agreementRate * 100)}% (${agreed}/${overall.n}) |`,
    );
    lines.push(`| Kappa Value | ${kappa} |`);
    lines.push(`| Number of Subject-Sessions | ${overall.n} |`);
    lines.push(`| Subject-Sessions Requiring Resolution | ${m.agreement.numberOfDisagreements} |`);
    lines.push("");
    lines.push(KAPPA_GUIDANCE);
    lines.push("");
    lines.push("| Group | n (subject-sessions) | Initial Agreement Rate | Kappa Value |");
    lines.push("|-------|---|----------------|-------------|");
    for (const group of m.agreement.perGroup) {
      const result = group.result;
      const groupKappa =
        result.kappa === null
          ? "N/A"
          : formatKappa(result.kappa, result.ci95Lower, result.ci95Upper);
      lines.push(
        `| ${group.label} | ${result.n} | ${Math.round(result.agreementRate * 100)}% | ${groupKappa} |`,
      );
    }
    lines.push("");
  }

  lines.push(`## Section ${m.agreement ? 5 : 4}: Pipeline Summary`);
  lines.push("");
  lines.push(m.pipelineParagraph);
  lines.push("");

  if (m.methodsParagraphs.length > 0) {
    lines.push("### Methods");
    lines.push("");
    lines.push(m.methodsDisclaimer);
    lines.push("");
    for (const paragraph of m.methodsParagraphs) {
      lines.push(paragraph);
      lines.push("");
    }
  }

  if (m.methodsReferences.length > 0) {
    lines.push("### References");
    lines.push("");
    for (const reference of m.methodsReferences) {
      lines.push(`- ${reference}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function simpleMarkdownToHtml(markdown: string): string {
  let inTable = false;
  let headerRendered = false;
  let inFencedCode = false;
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    // Handle fenced code blocks
    if (line.startsWith("```")) {
      if (!inFencedCode) {
        if (inTable) {
          out.push("</tbody></table>");
          inTable = false;
          headerRendered = false;
        }
        out.push("<pre><code>");
        inFencedCode = true;
      } else {
        out.push("</code></pre>");
        inFencedCode = false;
      }
      continue;
    }
    if (inFencedCode) {
      out.push(escapeHtml(line));
      continue;
    }
    if (line.startsWith("# ")) {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
        headerRendered = false;
      }
      out.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
        headerRendered = false;
      }
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
        headerRendered = false;
      }
      out.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("|")) {
      if (/^\|[-| ]+\|$/.test(line)) {
        if (!headerRendered) {
          headerRendered = true;
        }
        continue;
      }
      const cells = line
        .split("|")
        .filter((_c, idx, arr) => idx > 0 && idx < arr.length - 1)
        .map((c) => c.trim());
      if (!inTable) {
        out.push("<table><thead>");
        inTable = true;
      }
      if (!headerRendered) {
        out.push("<tr>" + cells.map((c) => `<th>${escapeHtml(c)}</th>`).join("") + "</tr>");
        out.push("</thead><tbody>");
        headerRendered = true;
      } else {
        out.push("<tr>" + cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("") + "</tr>");
      }
    } else if (line.startsWith("- ")) {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
        headerRendered = false;
      }
      out.push(`<p>${escapeHtml(line.slice(2))}</p>`);
    } else if (line === "") {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
        headerRendered = false;
      }
    } else {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
        headerRendered = false;
      }
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inTable) {
    out.push("</tbody></table>");
  }
  return out.join("\n");
}

export function renderHtml(m: ManifestPayload): string {
  const markdownBody = simpleMarkdownToHtml(renderMarkdown(m));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Project Manifest</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #222; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; table-layout: fixed; }
th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
th:first-child, td:first-child { width: 40%; }
th:last-child, td:last-child { width: 60%; }
h2 { border-bottom: 2px solid #eee; padding-bottom: 0.25rem; margin-top: 2rem; }
h3 { margin-top: 1.5rem; }
pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 1rem; overflow-x: auto; font-size: 0.875rem; }
pre code { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; white-space: pre; }
</style>
</head>
<body>
${markdownBody}
</body>
</html>`;
}
