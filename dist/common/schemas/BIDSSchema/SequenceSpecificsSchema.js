import * as Yup from "yup";
// https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#sequence-specifics
/** Minimal schema to ensure PulseSequenceType is an **optional** string enum */
export const SchemaMin_PulseSequenceType = Yup.string()
    .typeError(`Pulse Sequence Type must be one of the following: "2D EPI", "3D Spiral", "3D GRASE"`)
    .oneOf(["2D_EPI", "3D_spiral", "3D_GRASE"], `Pulse Sequence Type must be one of the following: "2D EPI", "3D Spiral", "3D GRASE"`);
/** Expanded schema for PulseSequenceType to ensure it is also required */
export const Schema_PulseSequenceType = SchemaMin_PulseSequenceType.required("Pulse Sequence Type is a required field");
/** Minimal schema to ensure ScanningSequence is an **optional** string */
export const SchemaMin_ScanningSequence = Yup.string()
    .optional()
    .typeError("Scanning Sequence must be text if provided");
/** Minimal schema to ensure SequenceVariant is an **optional** string */
export const SchemaMin_SequenceVariant = Yup.string().optional().typeError("Sequence Variant must be text if provided");
/** Minimal schema to ensure SequenceName is an **optional** string */
export const SchemaMin_SequenceName = Yup.string().optional().typeError("Sequence Name must be text if provided");
/** Minimal schema to ensure MRAcquisitionType is an **optional** string enum */
export const SchemaMin_MRAcquisitionType = Yup.string()
    .typeError(`MR Acquisition Dimensionality must be one of the following: "2D", "3D"`)
    .oneOf(["2D", "3D"], `MR Acquisition Dimensionality must be one of the following: "2D", "3D"`);
/** Expanded schema for MRAcquisitionType to ensure it is also required */
export const Schema_MRAcquisitionType = SchemaMin_MRAcquisitionType.required("MR Acquisition Dimensionality is a required field");
/**
 * Minimal schema for SequenceSpecifics-related fields
 * These cover the minimal requirement for being placeable into input fields like BIDSDataGrid
 */
export const SchemaMin_SequenceSpecificFields = Yup.object().shape({
    PulseSequenceType: SchemaMin_PulseSequenceType,
    ScanningSequence: SchemaMin_ScanningSequence,
    SequenceVariant: SchemaMin_SequenceVariant,
    SequenceName: SchemaMin_SequenceName,
    MRAcquisitionType: SchemaMin_MRAcquisitionType,
});
/**
 * Schema for SequenceSpecifics-related fields
 * @see https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#sequence-specifics
 */
export const Schema_SequenceSpecificFields = Yup.object().shape({
    PulseSequenceType: Schema_PulseSequenceType,
    ScanningSequence: SchemaMin_ScanningSequence,
    SequenceVariant: SchemaMin_SequenceVariant,
    SequenceName: SchemaMin_SequenceName,
    MRAcquisitionType: Schema_MRAcquisitionType,
});
//# sourceMappingURL=SequenceSpecificsSchema.js.map