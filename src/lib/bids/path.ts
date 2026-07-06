/**
 * BIDS filename and directory name utilities.
 *
 * Parses BIDS 1.x entity pairs in any order from filenames like
 * `sub-01_ses-02_run-03_acq-pcasl_task-rest_asl.nii.gz`. BIDS does not
 * enforce a strict ordering of optional entities in filenames (only the
 * recommended order is alphabetical), so this parser is order-agnostic.
 */

/**
 * Pattern: `sub-{label}(_{key}-{value})*_{suffix}.{ext}[.gz]`
 *
 * - `sub-` is mandatory and must come first.
 * - Zero or more `{key}-{value}` entity pairs follow, each preceded by `_`.
 * - A trailing `_{suffix}.{ext}[.gz]` is required.
 * - Entity keys and suffix are restricted to alphanumerics so the regex
 *   can distinguish an entity pair from a bare suffix.
 */
const BIDS_FILENAME_RE =
  /^sub-([^\s_/]+)((?:_[a-zA-Z][a-zA-Z0-9]*-[^\s_.]+)*)_([A-Za-z0-9]+)\.(nii|json|tsv)(\.gz)?$/;

/** Extract `_{key}-{value}` entity pairs (without leading `_`). */
const ENTITY_RE = /_([a-zA-Z][a-zA-Z0-9]*)-([^\s_]+)/g;

/**
 * Returns true if `filename` (name only, no directory) looks like a BIDS file.
 * Conservative: must match the canonical `sub-..._suffix.ext[.gz]` pattern.
 */
export function isBidsFilename(filename: string): boolean {
  return BIDS_FILENAME_RE.test(filename);
}

/**
 * Parse BIDS entities from a filename. Returns a map with keys like
 * `sub`, `ses`, `run`, `acq`, `task`, `suffix`. Returns `{}`
 * if the filename doesn't match the BIDS pattern.
 *
 * Order-agnostic: entities may appear in any order between the leading
 * `sub-<label>` and the trailing `_{suffix}.{ext}`.
 */
export function parseBidsEntities(filename: string): Record<string, string> {
  const m = filename.match(BIDS_FILENAME_RE);
  if (!m) return {};
  const result: Record<string, string> = { sub: m[1], suffix: m[3] };
  const middle = m[2];
  if (middle) {
    ENTITY_RE.lastIndex = 0;
    let e: RegExpExecArray | null;
    while ((e = ENTITY_RE.exec(middle)) !== null) {
      // Don't overwrite the `sub` entity captured from the prefix.
      if (e[1] !== "sub") {
        result[e[1]] = e[2];
      }
    }
  }
  return result;
}

/**
 * Returns true if `filename` ends with `_asl.nii`, `_asl.nii.gz`, or `_asl.json`.
 */
export function isAslSuffix(filename: string): boolean {
  return /_asl\.(nii(\.gz)?|json)$/.test(filename);
}

/**
 * Returns true if `filename` ends with `_m0scan.nii`, `_m0scan.nii.gz`, or `_m0scan.json`.
 */
export function isM0Suffix(filename: string): boolean {
  return /_m0scan\.(nii(\.gz)?|json)$/.test(filename);
}

/**
 * Returns true if `name` is a BIDS subject directory name (starts with `sub-`).
 * Assumes name-only (no path separator).
 */
export function isSubjectDir(name: string): boolean {
  return /^sub-/.test(name) && !name.includes("/");
}

/**
 * Returns true if `name` is a BIDS session directory name (starts with `ses-`).
 * Assumes name-only (no path separator).
 */
export function isSessionDir(name: string): boolean {
  return /^ses-/.test(name) && !name.includes("/");
}
