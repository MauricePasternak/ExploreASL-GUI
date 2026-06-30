export interface ManifestPayload {
  metadataGroups: Array<{
    label: string;
    nSubjects: number;
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
  }>;
  pipelineParagraph: string;
  methodsParagraphs: string[];
  methodsReferences: string[];
  dataPar?: Record<string, unknown>;
}

/**
 * Returns a sanitised copy of the dataPar object suitable for export:
 * - x.dataset.subjectRegexp defaults to "^sub-.*" if absent/empty
 * - x.dataset.ForceInclusionList is omitted (not relevant for reproducibility)
 */
function sanitiseDataParForExport(dataPar: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(dataPar) as Record<string, unknown>;
  const x = copy["x"] as Record<string, unknown> | undefined;
  if (x) {
    const dataset = x["dataset"] as Record<string, unknown> | undefined;
    if (dataset) {
      dataset["subjectRegexp"] = "^sub-.*";
      delete dataset["ForceInclusionList"];
    }
  }
  return copy;
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
    lines.push(`| N Subjects | ${g.nSubjects} |`);
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
    lines.push("```json");
    lines.push(JSON.stringify(sanitiseDataParForExport(m.dataPar), null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push("## Section 3: QC Summary");
  lines.push("");
  for (const g of m.qcGroups) {
    lines.push(`### ${g.label}`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Pass / Total | ${g.passTotal} |`);
    lines.push(`| Mean ASL Coverage % (SD) | ${g.coverage} |`);
    lines.push(`| Mean Spatial CoV % (SD) | ${g.spatialCov} |`);
    lines.push(`| Mean Motion (mm RMS) (SD) | ${g.motion} |`);
    lines.push(`| Mean Motion Exclusion % (SD) | ${g.motionExclusion} |`);
    lines.push(`| Fail Reasons | ${g.failReasons} |`);
    lines.push("");
  }

  lines.push("## Section 4: Pipeline Summary");
  lines.push("");
  lines.push(m.pipelineParagraph);
  lines.push("");

  if (m.methodsParagraphs.length > 0) {
    lines.push("### Methods");
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
