import { GridColDef } from "@mui/x-data-grid";
import BIDSBooleanRenderField from "../BIDSDataGridCellComponents/BIDSBooleanRenderField";
import { BIDSRow } from "./BIDSMergeColDefs";

// ^ Field Names
export const BIDSBooleanFields = ["BackgroundSuppression", "BolusCutOffFlag", "SkullStripped"] as const;
export type BIDSBooleanFieldsNameType = typeof BIDSBooleanFields[number];
export const BIDSBooleanFieldsSet = new Set(BIDSBooleanFields);

// ^ Type Guard
export function isBIDSBooleanField(fieldName: string): fieldName is BIDSBooleanFieldsNameType {
	return BIDSBooleanFieldsSet.has(fieldName as BIDSBooleanFieldsNameType);
}

// ^ Column Definitions
type BIDSBooleanBaseColDef<TName extends BIDSBooleanFieldsNameType = BIDSBooleanFieldsNameType> = {
	field: TName; // field name must be present for compatibility with GridColDef
	type: "boolean";
	defaultValue?: boolean;
	BIDSType: "Boolean";
};
export type BIDSBooleanColDef<
	TRow extends BIDSRow = BIDSRow,
	TName extends BIDSBooleanFieldsNameType = BIDSBooleanFieldsNameType
> = Omit<GridColDef<TRow>, "field" | "type"> & BIDSBooleanBaseColDef<TName>;

// ^ Column Definitions Map
export type BIDSBooleanFieldToColDefType<
	TName extends BIDSBooleanFieldsNameType = BIDSBooleanFieldsNameType,
	TRow extends BIDSRow = BIDSRow
> = {
	[K in TName]: BIDSBooleanColDef<TRow, K>;
};
export const BIDSBooleanFieldToColDef: BIDSBooleanFieldToColDefType = {
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
		description:
			`True/False of whether a bolus cut-off technique was used. ` +
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
