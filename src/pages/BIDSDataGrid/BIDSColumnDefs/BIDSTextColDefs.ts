import { GridColDef } from "@mui/x-data-grid";
import { BIDSRow } from "./BIDSMergeColDefs";

// ^ Field Names
export const BIDSTextFields = [
	"PulseSequenceDetails",
	"ReceiveCoilName",
	"ScanningSequence",
	"SequenceName",
	"SequenceVariant",
	"SoftwareVersions",
] as const;
export type BIDSTextFieldsNameType = typeof BIDSTextFields[number];
export const BIDSTextFieldsSet = new Set(BIDSTextFields);

// ^ Type Guard
export function isBIDSTextField(fieldName: string): fieldName is BIDSTextFieldsNameType {
	return BIDSTextFieldsSet.has(fieldName as BIDSTextFieldsNameType);
}

// ^ Column Definitions
type BIDSTextBaseColDef<TName extends BIDSTextFieldsNameType = BIDSTextFieldsNameType> = {
	field: TName; // field name must be present for compatibility with GridColDef
	type: "string";
	defaultValue?: string;
	BIDSType: "Text";
};
export type BIDSTextColDef<
	TRow extends BIDSRow = BIDSRow,
	TName extends BIDSTextFieldsNameType = BIDSTextFieldsNameType
> = Omit<GridColDef<TRow>, "field" | "type"> & BIDSTextBaseColDef<TName>;

// ^ Column Definitions Map
export type BIDSTextFieldToColDefType<
	TName extends BIDSTextFieldsNameType = BIDSTextFieldsNameType,
	TRow extends BIDSRow = BIDSRow
> = {
	[K in TName]: BIDSTextColDef<TRow, K>;
};
export const BIDSTextFieldToColDef: BIDSTextFieldToColDefType = {
	PulseSequenceDetails: {
		field: "PulseSequenceDetails",
		headerName: "Pulse Sequence Details",
		BIDSType: "Text",
		type: "string",
		editable: true,
		width: 600,
		description:
			`Information beyond pulse sequence type that identifies the specific pulse sequence used ` +
			`(for example, "Standard Siemens Sequence distributed with the VB17 software"`,
	},
	ReceiveCoilName: {
		field: "ReceiveCoilName",
		headerName: "Receive Coil Name",
		BIDSType: "Text",
		type: "string",
		editable: true,
		width: 180,
		description: `Information describing the receiver coil.`,
	},
	ScanningSequence: {
		field: "ScanningSequence",
		headerName: "Scanning Sequence",
		BIDSType: "Text",
		type: "string",
		editable: true,
		width: 180,
		description: `Description of the type of data acquired.`,
	},
	SequenceName: {
		field: "SequenceName",
		headerName: "Sequence Name",
		BIDSType: "Text",
		type: "string",
		editable: true,
		width: 180,
		description: `Manufacturer's designation of the sequence name.`,
	},
	SequenceVariant: {
		field: "SequenceVariant",
		headerName: "Sequence Variant",
		BIDSType: "Text",
		type: "string",
		editable: true,
		width: 180,
		description: `Description of the particular variant of the value in "Scanning Sequence"`,
	},
	SoftwareVersions: {
		field: "SoftwareVersions",
		headerName: "Software Version",
		BIDSType: "Text",
		type: "string",
		editable: true,
		width: 400,
		description: `Manufacturer's designation of the software version used to collect the data.`,
	},
};
