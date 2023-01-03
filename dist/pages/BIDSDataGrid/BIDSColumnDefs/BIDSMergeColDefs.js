import { BIDSBooleanFields, isBIDSBooleanField } from "./BIDSBooleanColDefs";
import { BIDSEnumFields, isBIDSEnumField } from "./BIDSEnumColDefs";
import { isMiscField, MiscFields } from "./BIDSMiscColDefs";
import { BIDSNumericArrayFields, isBIDSNumericArrayField, } from "./BIDSNumericArrayColDefs";
import { BIDSNumericFields, isBIDSNumericField } from "./BIDSNumericColDefs";
import { BIDSTextFields, isBIDSTextField } from "./BIDSTextColDefs";
export const BIDSAllNonMiscFieldsSet = new Set([
    ...BIDSNumericFields,
    ...BIDSNumericArrayFields,
    ...BIDSTextFields,
    ...BIDSEnumFields,
    ...BIDSBooleanFields,
]);
export const BIDSAllFieldsSet = new Set([
    ...MiscFields,
    ...BIDSNumericFields,
    ...BIDSNumericArrayFields,
    ...BIDSTextFields,
    ...BIDSEnumFields,
    ...BIDSBooleanFields,
]);
// ^ Type Guards
export function isBIDSNonMiscField(fieldName) {
    return BIDSAllNonMiscFieldsSet.has(fieldName);
}
export function isBIDSField(fieldName) {
    return (isMiscField(fieldName) ||
        isBIDSNumericField(fieldName) ||
        isBIDSNumericArrayField(fieldName) ||
        isBIDSTextField(fieldName) ||
        isBIDSEnumField(fieldName) ||
        isBIDSBooleanField(fieldName));
}
// ^ FieldNameToDisplayName
export const BIDSFieldNameToDisplayName = {
    // Misc Fields
    ID: "ID",
    Filepath: "Filepath",
    Filename: "Filename",
    // Numeric Fields
    BackgroundSuppressionNumberPulses: "Background Suppression Number Pulses",
    BolusCutOffDelayTime: "Bolus Cut Off Delay Time (s)",
    EchoTime: "Echo Time (s)",
    FlipAngle: "Flip Angle (deg)",
    InversionTime: "Inversion Time (s)",
    MagneticFieldStrength: "Magnetic Field Strength (T)",
    M0Estimate: "M0 Estimate (a.u.)",
    M0_GMScaleFactor: "M0 GM Scale Factor (a.u.)",
    RepetitionTimePreparation: "Repetition Time Preparation (s)",
    TotalAcquiredPairs: "Total Acquired Pairs",
    TotalReadoutTime: "Total Readout Time (s)",
    // Numeric Array Fields
    BackgroundSuppressionPulseTime: "Background Suppression Pulse Timings (s)",
    PostLabelingDelay: "Post Labeling Delay (s)",
    LabelingDuration: "Labeling Duration (s)",
    SliceTiming: "Slice Timing (s)",
    // Text Fields
    PulseSequenceDetails: "Pulse Sequence Details",
    ReceiveCoilName: "Receive Coil Name",
    ScanningSequence: "Scanning Sequence",
    SequenceName: "Sequence Name",
    SequenceVariant: "Sequence Variant",
    SoftwareVersions: "Software Versions",
    // Enum Fields
    ArterialSpinLabelingType: "Arterial Spin Labeling Type",
    BolusCutOffTechnique: "Bolus Cut Off Technique",
    CASLType: "CASL Type",
    Manufacturer: "Manufacturer",
    M0Type: "M0 Type",
    MRAcquisitionType: "MR Acquisition Type",
    PASLType: "PASL Type",
    PCASLType: "PCASL Type",
    PulseSequenceType: "Pulse Sequence Type",
    PhaseEncodingDirection: "Phase Encoding Direction",
    SliceEncodingDirection: "Slice Encoding Direction",
    // Boolean Fields
    BackgroundSuppression: "Background Suppression",
    BolusCutOffFlag: "Bolus Cut Off Flag",
    SkullStripped: "Skull Stripped",
};
//# sourceMappingURL=BIDSMergeColDefs.js.map