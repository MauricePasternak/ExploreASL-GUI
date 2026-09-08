/**
 * BIDS folder module — centralized BIDS utilities for the ExploreASL GUI.
 *
 * - path.ts: filename/directory name parsing
 * - sidecar.ts: sidecar parsing, fingerprinting, ASLContext utilities
 * - schema.ts: re-exports of BidsAslMetadata schemas and types
 * - normalize.ts: Zod transforms for PulseSequenceType and Manufacturer
 */

export {
  isBidsFilename,
  parseBidsEntities,
  isAslSuffix,
  isM0Suffix,
  isSubjectDir,
  isSessionDir,
} from "./path";

export {
  summarizeAslContext,
  parseAslContext,
  validateBidsAslParams,
  /** Display/debug only — Rust owns fingerprint hashing. */
  extractFingerprint,
  /** Display/debug only — use Rust SidecarGroup vendor/sequence/labelingType fields. */
  deriveInjectedFields,
} from "./sidecar";

export { flattenBidsGroupsToSubjectRows, stripSubjectPrefix } from "./subjectRows";

export {
  BidsAslMetadataSchema,
  BidsAslMetadataBaseSchema,
  type MetadataGroup,
  type SubjectRow,
  type DerivedMetadataGroup,
} from "./schema";

export { normalizePulseSequenceType, normalizeManufacturer, sanitizeLabel } from "./normalize";
