// ^ Field Names
export const BIDSTextFields = [
    "PulseSequenceDetails",
    "ReceiveCoilName",
    "ScanningSequence",
    "SequenceName",
    "SequenceVariant",
    "SoftwareVersions",
];
export const BIDSTextFieldsSet = new Set(BIDSTextFields);
// ^ Type Guard
export function isBIDSTextField(fieldName) {
    return BIDSTextFieldsSet.has(fieldName);
}
export const BIDSTextFieldToColDef = {
    PulseSequenceDetails: {
        field: "PulseSequenceDetails",
        headerName: "Pulse Sequence Details",
        BIDSType: "Text",
        type: "string",
        editable: true,
        width: 600,
        description: `Information beyond pulse sequence type that identifies the specific pulse sequence used ` +
            `(i.e. "Standard Siemens Sequence distributed with the VB17 software")`,
    },
    ReceiveCoilName: {
        field: "ReceiveCoilName",
        headerName: "Receive Coil Name",
        BIDSType: "Text",
        type: "string",
        editable: true,
        width: 180,
        description: `Information describing the receiver coil used (i.e. "SENSE-Head-8").`,
    },
    ScanningSequence: {
        field: "ScanningSequence",
        headerName: "Scanning Sequence",
        BIDSType: "Text",
        type: "string",
        editable: true,
        width: 180,
        description: `Shorthand descriptor of the type of sequence used (i.e. SE for Spin Echo, IR for Inversion Recovery, etc.).`,
    },
    SequenceName: {
        field: "SequenceName",
        headerName: "Sequence Name",
        BIDSType: "Text",
        type: "string",
        editable: true,
        width: 180,
        description: `Manufacturer's custom designation of the "Scanning Sequence" and "Sequence Variant" combination used (i.e. "*tgse3d1_3968")`,
    },
    SequenceVariant: {
        field: "SequenceVariant",
        headerName: "Sequence Variant",
        BIDSType: "Text",
        type: "string",
        editable: true,
        width: 180,
        description: `Description of the particular variant(s) of the value in "Scanning Sequence" (i.e. "SK" for segmented k-space, "SP" for spoiled)`,
    },
    SoftwareVersions: {
        field: "SoftwareVersions",
        headerName: "Software Version",
        BIDSType: "Text",
        type: "string",
        editable: true,
        width: 400,
        description: `Manufacturer's designation of the software version used to collect the data (i.e. "N4_VB17A_LATEST_20090307").`,
    },
};
//# sourceMappingURL=BIDSTextColDefs.js.map