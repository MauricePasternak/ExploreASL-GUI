function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;

  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(len2 - 1, i + matchWindow);

    for (let j = start; j <= end; j++) {
      if (matches2[j]) continue;
      if (s1[i] === s2[j]) {
        matches1[i] = true;
        matches2[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3.0;

  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefix++;
    } else {
      break;
    }
  }

  return jaro + prefix * 0.1 * (1.0 - jaro);
}

function fuzzyMatchToken(value: string, target: string, threshold = 0.8): boolean {
  const val = value.toLowerCase();
  const tgt = target.toLowerCase();
  const tokens = val.split(/[_\- ]+/);
  for (const token of tokens) {
    if (!token) continue;
    const sim = jaroWinkler(token, tgt);
    if (sim >= threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize a PulseSequenceType string via case-insensitive substring matching,
 * symmetric with ExploreASL's MATLAB regexpi pattern. Returns canonical form
 * or undefined if unrecognized (ExploreASL's rmfield semantics).
 */
export function normalizePulseSequenceType(val: string): string | undefined {
  const v = val.toLowerCase();
  if (v.includes("epi") || v.includes("ep2d") || v.includes("epfid") || v.includes("pepolar")) {
    return "EPI";
  }
  if (v.includes("grase") || v.includes("tgse")) return "GRASE";
  if (v.includes("spiral")) return "spiral";

  // Fallback fuzzy matching
  if (
    fuzzyMatchToken(v, "epi") ||
    fuzzyMatchToken(v, "ep2d") ||
    fuzzyMatchToken(v, "epfid") ||
    fuzzyMatchToken(v, "pepolar")
  ) {
    return "EPI";
  }
  if (fuzzyMatchToken(v, "grase") || fuzzyMatchToken(v, "tgse")) {
    return "GRASE";
  }
  if (fuzzyMatchToken(v, "spiral")) {
    return "spiral";
  }

  return undefined;
}

/**
 * Normalize a Manufacturer string via case-insensitive substring matching,
 * symmetric with ExploreASL's MATLAB regexpi pattern. Returns canonical form
 * or undefined if unrecognized.
 */
export function normalizeManufacturer(val: string): string | undefined {
  const v = val.toLowerCase();
  if (v.includes("siemens")) return "Siemens";
  if (v.includes("philips")) return "Philips";
  if (v.includes("ge")) return "GE_product";

  // Fallback fuzzy matching
  if (fuzzyMatchToken(v, "siemens")) return "Siemens";
  if (fuzzyMatchToken(v, "philips")) return "Philips";
  if (fuzzyMatchToken(v, "ge") || fuzzyMatchToken(v, "ge_product")) return "GE_product";

  return undefined;
}

/**
 * Block-list sanitizer for user-edited BIDS group labels (Phase 11.1).
 *
 * Real datasets occasionally contain labels with characters that break
 * downstream consumption (filesystem paths, JSON keys, ExploreASL's
 * `StudyPars` regex). Rather than silently rewriting labels at confirm time,
 * we strip-block the offending characters at the input layer so the user
 * never sees them enter the field. The block list:
 *   `/`, `\`, `<`, `>`, `"`, `` ` ``, `$`, `*`, `?`, `|`, `;`,
 *   newlines, and C0 control chars `\x00-\x1F`.
 *
 * Whitelist is intentionally permissive: alphanumerics (incl. Unicode letters
 * such as Chinese characters), space, `_`, `-`, `.`, `(`, `)` survive — this
 * preserves the auto-suggested label format (`Siemens_3T_PCASL_3D_Included`)
 * and the collision suffix `_(2)`.
 */
const ctrlStart = String.fromCharCode(0);
const ctrlEnd = String.fromCharCode(31);
const BLOCKED_LABEL_CHARS = new RegExp(`[/\\\\<>"\`$*?|;${ctrlStart}-${ctrlEnd}]`, "g");

export function sanitizeLabel(input: string): string {
  return input.replace(BLOCKED_LABEL_CHARS, "");
}
