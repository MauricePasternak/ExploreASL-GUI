import type { ManifestVerdict } from "../../schemas/project";
import type { ManifestDisagreement } from "../../stores/manifestStore";

export function areDisagreementsResolved(
  disagreements: ManifestDisagreement[],
  resolvedVerdicts: Record<string, ManifestVerdict> | undefined,
) {
  return disagreements.every((disagreement) =>
    Boolean(resolvedVerdicts?.[disagreement.subjectSession]),
  );
}
