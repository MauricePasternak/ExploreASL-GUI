/**
 * Condenses an ASLContext string by run-length encoding adjacent identical tokens,
 * grouping alternating control-label/label-control pairs, and appending " x{count}"
 * for counts greater than 1 (omitting it for single items).
 */
export function summarizeAslContext(raw: string | undefined): string {
  if (!raw) return "";
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "";

  // 1. Initial run-length encoding of identical adjacent tokens
  const runs: { token: string; count: number }[] = [];
  for (const token of tokens) {
    const last = runs[runs.length - 1];
    if (last && last.token === token) {
      last.count++;
    } else {
      runs.push({ token, count: 1 });
    }
  }

  // 2. Group alternating singletons of control and label into pairs
  const groupedRuns: { token: string; count: number }[] = [];
  let j = 0;
  while (j < runs.length) {
    // Check for label-control pairs starting at j
    let labelControlPairs = 0;
    while (j + 2 * labelControlPairs + 1 < runs.length) {
      const r1 = runs[j + 2 * labelControlPairs];
      const r2 = runs[j + 2 * labelControlPairs + 1];
      if (r1.token === "label" && r1.count === 1 && r2.token === "control" && r2.count === 1) {
        labelControlPairs++;
      } else {
        break;
      }
    }

    if (labelControlPairs > 0) {
      groupedRuns.push({ token: "label-control pair", count: labelControlPairs });
      j += 2 * labelControlPairs;
      continue;
    }

    // Check for control-label pairs starting at j
    let controlLabelPairs = 0;
    while (j + 2 * controlLabelPairs + 1 < runs.length) {
      const r1 = runs[j + 2 * controlLabelPairs];
      const r2 = runs[j + 2 * controlLabelPairs + 1];
      if (r1.token === "control" && r1.count === 1 && r2.token === "label" && r2.count === 1) {
        controlLabelPairs++;
      } else {
        break;
      }
    }

    if (controlLabelPairs > 0) {
      groupedRuns.push({ token: "control-label pair", count: controlLabelPairs });
      j += 2 * controlLabelPairs;
      continue;
    }

    // If no pairs matched, just push the current run
    groupedRuns.push(runs[j]);
    j++;
  }

  // 3. Format output: if count > 1, append " x{count}", else just the token name
  return groupedRuns
    .map((r) => {
      if (r.count > 1) {
        return `${r.token} x${r.count}`;
      }
      return r.token;
    })
    .join(", ");
}
