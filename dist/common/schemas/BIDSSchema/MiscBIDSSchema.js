import * as Yup from "yup";
/** Minimal schema to ensure SkillStripped is an **optional** boolean */
export const SchemaMin_SkullStripped = Yup.boolean()
    .optional()
    .typeError("Skull Stripped must be true or false, if provided");
/** Minimal schema to ensure M0_GMScaleFactor is an **optional** positive number */
export const SchemaMin_M0_GMScaleFactor = Yup.number()
    .positive("M0 Gray Matter Scale Factor must be a positive number")
    .optional()
    .typeError("M0 Gray Matter Scale Factor must be a number, if provided");
/**
 * Minimal schema for BIDS Miscellaneous fields
 * These cover the minimal requirement for being placeable into input fields like BIDSDataGrid
 */
export const SchemaMin_BIDSMiscellaneousFields = Yup.object().shape({
    SkullStripped: SchemaMin_SkullStripped,
    M0_GMScaleFactor: SchemaMin_M0_GMScaleFactor,
});
/**
 * Schema for fields that are either not part of the official BIDS spec, or are not in any identifiable
 * BIDS group of fields.
 */
export const Schema_BIDSMiscellaneousFields = Yup.object().shape({
    SkullStripped: SchemaMin_SkullStripped,
    M0_GMScaleFactor: SchemaMin_M0_GMScaleFactor, // This is an optional field
});
//# sourceMappingURL=MiscBIDSSchema.js.map