/**
 * Normalize a BIDS / ExploreASL ASL run label to ExploreASL legacy numeric form.
 *
 * ExploreASL BIDS2Legacy uses `xASL_str2num` on the BIDS `run-` entity and writes
 * `ASL_<N>` folders/logs. Missing or non-numeric runs default to 1.
 *
 * Examples: "01" → "1", "ASL_01" → "1", "2" → "2", "" → "1", "pre" → "1"
 */
export function normalizeAslRunId(raw: string | null | undefined): string {
  if (raw == null) return "1";
  let s = raw.trim();
  if (/^ASL_/i.test(s)) {
    s = s.slice(4);
  }
  if (s === "") return "1";
  if (/^\d+$/.test(s)) {
    const parsed = Number.parseInt(s, 10);
    if (parsed >= 1) return String(parsed);
  }
  return "1";
}

/** True when two run labels refer to the same ExploreASL ASL_<N> session. */
export function aslRunsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return normalizeAslRunId(a) === normalizeAslRunId(b);
}

/** Convert a canonical run id to ExploreASL legacy session label (`ASL_1`). */
export function toExploreAslSessionLabel(run: string): string {
  return `ASL_${normalizeAslRunId(run)}`;
}
