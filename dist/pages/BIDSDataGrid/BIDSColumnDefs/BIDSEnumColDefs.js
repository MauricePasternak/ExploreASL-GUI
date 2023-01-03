// ^ Field Names
export const BIDSEnumFields = [
    "ArterialSpinLabelingType",
    "BolusCutOffTechnique",
    "CASLType",
    "Manufacturer",
    "M0Type",
    "MRAcquisitionType",
    "PASLType",
    "PCASLType",
    "PulseSequenceType",
    "PhaseEncodingDirection",
    "SliceEncodingDirection",
];
export const BIDSEnumFieldsSet = new Set(BIDSEnumFields);
// ^ Type Guard
export function isBIDSEnumField(fieldName) {
    return BIDSEnumFieldsSet.has(fieldName);
}
// ^ Enum Value2Label Mappings
export const BIDSEnumValue2Label = {
    ArterialSpinLabelingType: {
        CASL: "CASL",
        PCASL: "PCASL",
        PASL: "PASL",
    },
    BolusCutOffTechnique: {
        QUIPSS: "QUIPSS",
        QUIPSSII: "QUIPSSII",
        Q2TIPS: "Q2TIPS",
    },
    CASLType: {
        "single-coil": "Single Coil",
        "double-coil": "Double Coil",
    },
    Manufacturer: {
        Philips: "Philips",
        Siemens: "Siemens",
        GE: "GE",
    },
    M0Type: {
        Separate: "Separate",
        Included: "Included",
        Absent: "Absent",
        Estimate: "Estimate",
    },
    MRAcquisitionType: {
        "2D": "2D",
        "3D": "3D",
    },
    PASLType: {
        FAIR: "FAIR",
        EPISTAR: "EPISTAR",
        PICORE: "PICORE",
    },
    PCASLType: {
        balanced: "Balanced",
        unbalanced: "Unbalanced",
    },
    PhaseEncodingDirection: {
        i: "First Axis (i) - Forward",
        "i-": "First Axis (i) - Reverse",
        j: "Second Axis (j) - Forward",
        "j-": "Second Axis (j) - Reverse",
        k: "Third Axis (k) - Forward",
        "k-": "Third Axis (k) - Reverse",
    },
    SliceEncodingDirection: {
        i: "First Axis (i) - Forward",
        "i-": "First Axis (i) - Reverse",
        j: "Second Axis (j) - Forward",
        "j-": "Second Axis (j) - Reverse",
        k: "Third Axis (k) - Forward",
        "k-": "Third Axis (k) - Reverse",
    },
    PulseSequenceType: {
        "2D_EPI": "2D EPI",
        "3D_GRASE": "3D GRASE",
        "3D_spiral": "3D Spiral",
    },
};
function BIDSEnumV2LMappingToArray(mapping) {
    return Object.entries(mapping).map(([value, label]) => ({ value, label }));
}
function BIDSEnumValueFormatter(params) {
    if (!params.value)
        return "";
    return BIDSEnumValue2Label[params.field][params.value];
}
export const BIDSEnumFieldToColDef = {
    ArterialSpinLabelingType: {
        field: "ArterialSpinLabelingType",
        headerName: "Arterial Spin Labeling Type",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.ArterialSpinLabelingType),
        editable: true,
        width: 240,
        description: `Type of the ASL labeling technique used. One of CASL, PCASL, or PASL.`,
        enumOptions: [
            { value: "CASL", label: "CASL" },
            { value: "PCASL", label: "PCASL" },
            { value: "PASL", label: "PASL" },
        ],
        defaultValue: "PCASL",
    },
    BolusCutOffTechnique: {
        field: "BolusCutOffTechnique",
        headerName: "Bolus Cut Off Technique",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.BolusCutOffTechnique),
        editable: true,
        width: 210,
        description: `For PASL sequences, the technique used to cut-off the bolus. One of QUIPSS, QUIPSSII, or Q2TIPS.`,
        enumOptions: [
            { value: "QUIPSS", label: "QUIPSS" },
            { value: "QUIPSSII", label: "QUIPSSII" },
            { value: "Q2TIPS", label: "Q2TIPS" },
        ],
        valueSetter: (params) => {
            const { value: newValue, row: oldRow } = params;
            const { BolusCutOffDelayTime } = oldRow;
            // Early exit if a comparison between these two fields is not possible
            if (BolusCutOffDelayTime == undefined || newValue == undefined)
                return Object.assign(Object.assign({}, oldRow), { BolusCutOffTechnique: newValue });
            // Case 1: BolusCutOffDelayTimeTechnique is "Q2TIPS" and BolusCutOffDelayTime is a number
            if (newValue === "Q2TIPS" && typeof BolusCutOffDelayTime === "number") {
                const newDelayTime = [BolusCutOffDelayTime, 2];
                console.log(`Adjusting BolusCutOffDelayTime from ${BolusCutOffDelayTime} to ${newDelayTime}`);
                return Object.assign(Object.assign({}, oldRow), { BolusCutOffTechnique: newValue, BolusCutOffDelayTime: newDelayTime });
            }
            // Case 2: BolusCutOffDelayTimeTechnique is not "Q2TIPS" and BolusCutOffDelayTime is an array
            if (newValue !== "Q2TIPS" && Array.isArray(BolusCutOffDelayTime)) {
                const newDelayTime = BolusCutOffDelayTime[0];
                console.log(`Adjusting BolusCutOffDelayTime from ${BolusCutOffDelayTime} to ${newDelayTime}`);
                return Object.assign(Object.assign({}, oldRow), { BolusCutOffTechnique: newValue, BolusCutOffDelayTime: newDelayTime });
            }
            return Object.assign(Object.assign({}, oldRow), { BolusCutOffTechnique: newValue });
        },
        defaultValue: "QUIPSSII",
    },
    CASLType: {
        field: "CASLType",
        headerName: "CASL Type",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.CASLType),
        editable: true,
        width: 120,
        description: `For CASL sequences, describes the nature of the coil used during data acquisition.` +
            `One of single-coil or double-coil.`,
        enumOptions: [
            { value: "single-coil", label: "Single Coil" },
            { value: "double-coil", label: "Double Coil" },
        ],
        valueFormatter: BIDSEnumValueFormatter,
        defaultValue: "single-coil",
    },
    Manufacturer: {
        field: "Manufacturer",
        headerName: "Manufacturer",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.Manufacturer),
        editable: true,
        width: 110,
        description: "Manufacturer of the scanner equipment used to acquire the data.",
        enumOptions: [
            { value: "Philips", label: "Philips" },
            { value: "Siemens", label: "Siemens" },
            { value: "GE", label: "GE" },
        ],
        defaultValue: "Siemens",
    },
    M0Type: {
        field: "M0Type",
        headerName: "M0 Type",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.M0Type),
        editable: true,
        width: 110,
        description: `Describes the type of M0 image associated with this scan. ` +
            `Should be "Absent" if there is no M0 present, "Separate" if the M0 is a separate scan, ` +
            `"Included" if the M0 is within the ASL scan, or "Estimate" if the M0 is a singular value.`,
        enumOptions: [
            { value: "Separate", label: "Separate" },
            { value: "Included", label: "Included" },
            { value: "Estimate", label: "Estimate" },
            { value: "Absent", label: "Absent" },
        ],
        defaultValue: "Separate",
    },
    MRAcquisitionType: {
        field: "MRAcquisitionType",
        headerName: "Acquisition Dimension",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.MRAcquisitionType),
        editable: true,
        width: 210,
        description: `Describes whether the image was acquired as a 2D or 3D image.`,
        enumOptions: [
            { value: "2D", label: "2D" },
            { value: "3D", label: "3D" },
        ],
        defaultValue: "3D",
    },
    PASLType: {
        field: "PASLType",
        headerName: "PASL Type",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.PASLType),
        editable: true,
        width: 120,
        description: `For PASL sequences, describes the type of labeling pulse used. One of FAIR, EPISTAR, or PICORE.`,
        enumOptions: [
            { value: "FAIR", label: "FAIR" },
            { value: "EPISTAR", label: "EPISTAR" },
            { value: "PICORE", label: "PICORE" },
        ],
        defaultValue: "FAIR",
    },
    PCASLType: {
        field: "PCASLType",
        headerName: "PCASL Type",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: [
            { value: "balanced", label: "Balanced" },
            { value: "unbalanced", label: "Unbalanced" },
        ],
        editable: true,
        width: 120,
        description: `For PCASL sequences, describes the type of gradient pulses used in the "control" condition. ` +
            `One of "balanced" or "unbalanced".`,
        enumOptions: [
            { value: "balanced", label: "Balanced" },
            { value: "unbalanced", label: "Unbalanced" },
        ],
        defaultValue: "balanced",
        valueFormatter: BIDSEnumValueFormatter,
    },
    PhaseEncodingDirection: {
        field: "PhaseEncodingDirection",
        headerName: "Phase Encoding Direction",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.PhaseEncodingDirection),
        editable: true,
        width: 240,
        description: `The direction along which MRI imaging phase encoding was performed. `,
        enumOptions: [
            { value: "i", label: "First Axis (i) - Forward" },
            { value: "i-", label: "First Axis (i) - Reverse" },
            { value: "j", label: "Second Axis (j) - Forward" },
            { value: "j-", label: "Second Axis (j) - Reverse" },
            { value: "k", label: "Third Axis (k) - Forward" },
            { value: "k-", label: "Third Axis (k) - Reverse" },
        ],
        defaultValue: "j",
        valueFormatter: BIDSEnumValueFormatter,
    },
    PulseSequenceType: {
        field: "PulseSequenceType",
        headerName: "Pulse Sequence Type",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.PulseSequenceType),
        editable: true,
        width: 160,
        description: `A general description of the pulse sequence used for the scan.` +
            ` For ASL scans this should be one of 2D EPI, 3D GRaSE, or 3D Spiral.`,
        enumOptions: [
            { value: "2D_EPI", label: "2D EPI" },
            { value: "3D_GRASE", label: "3D GRaSE" },
            { value: "3D_spiral", label: "3D Spiral" },
        ],
        defaultValue: "3D_GRASE",
    },
    SliceEncodingDirection: {
        field: "SliceEncodingDirection",
        headerName: "Slice Encoding Direction",
        BIDSType: "Enum",
        type: "singleSelect",
        valueOptions: BIDSEnumV2LMappingToArray(BIDSEnumValue2Label.SliceEncodingDirection),
        editable: true,
        width: 240,
        description: `The direction along which MRI imaging slice encoding was performed. `,
        enumOptions: [
            { value: "i", label: "First Axis (i) - Forward" },
            { value: "i-", label: "First Axis (i) - Reverse" },
            { value: "j", label: "Second Axis (j) - Forward" },
            { value: "j-", label: "Second Axis (j) - Reverse" },
            { value: "k", label: "Third Axis (k) - Forward" },
            { value: "k-", label: "Third Axis (k) - Reverse" },
        ],
        valueGetter: BIDSEnumValueFormatter,
        defaultValue: "i",
    },
};
//# sourceMappingURL=BIDSEnumColDefs.js.map