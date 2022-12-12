import { GridColDef } from "@mui/x-data-grid";
import { BIDSRow } from "./BIDSMergeColDefs";

// ^ Field Names
export const MiscFields = ["ID", "Filepath", "Filename"] as const;
export type MiscFieldsNameType = typeof MiscFields[number];
export const MiscFieldsSet = new Set(MiscFields);

// ^ Type Guard
export function isMiscField(fieldName: string): fieldName is MiscFieldsNameType {
	return MiscFieldsSet.has(fieldName as MiscFieldsNameType);
}

// ^ Column Definitions
type MiscBaseColDef<TName extends MiscFieldsNameType = MiscFieldsNameType> = {
	field: TName; // field name must be present for compatibility with GridColDef
	type: "string" | "number";
	BIDSType: "Misc";
};
export type MiscColDef<TRow extends BIDSRow = BIDSRow, TName extends MiscFieldsNameType = MiscFieldsNameType> = Omit<
	GridColDef<TRow>,
	"field" | "type"
> &
	MiscBaseColDef<TName>;

// ^ Column Definitions Map
export type MiscFieldToColDefType<
	TName extends MiscFieldsNameType = MiscFieldsNameType,
	TRow extends BIDSRow = BIDSRow
> = {
	[K in TName]: MiscColDef<TRow, K>;
};
export const MiscFieldToColDef: MiscFieldToColDefType = {
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
		description:
			"Filename of the ASL BIDS sidecar JSON file found under " + "STUDYROOT/rawdata/sub-*/sess-*/perf/*asl.json",
		width: 450,
	},
};
