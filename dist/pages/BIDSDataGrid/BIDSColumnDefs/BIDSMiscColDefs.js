// ^ Field Names
export const MiscFields = ["ID", "Filepath", "Filename"];
export const MiscFieldsSet = new Set(MiscFields);
// ^ Type Guard
export function isMiscField(fieldName) {
    return MiscFieldsSet.has(fieldName);
}
export const MiscFieldToColDef = {
    ID: {
        field: "ID",
        headerName: "ID",
        BIDSType: "Misc",
        type: "number",
        editable: false,
        filterable: false,
        hideable: false,
        description: "Unique ID for each row",
    },
    Filepath: {
        field: "Filepath",
        headerName: "Filepath",
        BIDSType: "Misc",
        type: "string",
        editable: false,
        filterable: false,
        hideable: false,
        hide: true, // Use the initialState prop on DataGrid to hide columns
    },
    Filename: {
        field: "Filename",
        headerName: "Filename",
        BIDSType: "Misc",
        type: "string",
        editable: false,
        filterable: false,
        hideable: false,
        description: "Filename of the ASL BIDS sidecar JSON file found under " + "STUDYROOT/rawdata/sub-*/sess-*/perf/*asl.json",
        width: 450,
    },
};
//# sourceMappingURL=BIDSMiscColDefs.js.map