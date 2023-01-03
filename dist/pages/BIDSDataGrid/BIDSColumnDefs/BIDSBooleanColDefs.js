import BIDSBooleanRenderField from "../BIDSDataGridCellComponents/BIDSBooleanRenderField";
// ^ Field Names
export const BIDSBooleanFields = ["BackgroundSuppression", "BolusCutOffFlag", "SkullStripped"];
export const BIDSBooleanFieldsSet = new Set(BIDSBooleanFields);
// ^ Type Guard
export function isBIDSBooleanField(fieldName) {
    return BIDSBooleanFieldsSet.has(fieldName);
}
export const BIDSBooleanFieldToColDef = {
    BackgroundSuppression: {
        field: "BackgroundSuppression",
        headerName: "Background Suppression",
        BIDSType: "Boolean",
        type: "boolean",
        renderCell: BIDSBooleanRenderField,
        editable: true,
        width: 200,
        description: `True/False of whether background suppression was used during the scan.`,
    },
    BolusCutOffFlag: {
        field: "BolusCutOffFlag",
        headerName: "Bolus Cut Off Flag",
        BIDSType: "Boolean",
        type: "boolean",
        renderCell: BIDSBooleanRenderField,
        editable: true,
        width: 200,
        description: `True/False of whether a bolus cut-off technique was used. ` +
            `This field should only be present for PASL data acquisitions`,
    },
    SkullStripped: {
        field: "SkullStripped",
        headerName: "Skull Stripped",
        BIDSType: "Boolean",
        type: "boolean",
        renderCell: BIDSBooleanRenderField,
        editable: true,
        width: 170,
        description: `True/False of whether the acquisition data was preprocessed to remove the skull voxels.`,
    },
};
//# sourceMappingURL=BIDSBooleanColDefs.js.map