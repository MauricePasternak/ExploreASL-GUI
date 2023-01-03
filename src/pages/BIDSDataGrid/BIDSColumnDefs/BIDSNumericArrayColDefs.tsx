import { GridColDef, GridRenderCellParams, GridValueFormatterParams } from "@mui/x-data-grid";
import React from "react";
import { BIDSCommaSepNumericField } from "../BIDSDataGridCellComponents/BIDSCommaSepNumericField";
import { BIDSRow } from "./BIDSMergeColDefs";

function formatAsCommaSeparatedValues(params: GridValueFormatterParams<any>) {
	if (params.value != null) return Array.isArray(params.value) ? params.value.join(", ") : params.value;
	return "";
}

// ^ Field Names

export const BIDSNumericArrayFields = [
	"BackgroundSuppressionPulseTime",
	"EchoTime",
	"LabelingDuration",
	"PostLabelingDelay",
	"SliceTiming",
] as const;

export type BIDSNumericArrayFieldsNameType = typeof BIDSNumericArrayFields[number];
export const BIDSNumericArrayFieldsSet = new Set(BIDSNumericArrayFields);

// ^ Type Guard

export function isBIDSNumericArrayField(fieldName: string): fieldName is BIDSNumericArrayFieldsNameType {
	return BIDSNumericArrayFieldsSet.has(fieldName as BIDSNumericArrayFieldsNameType);
}

// ^ Column Definitions
type BIDSNumericArrayBaseColDef<TName extends BIDSNumericArrayFieldsNameType = BIDSNumericArrayFieldsNameType> = {
	field: TName; // field name must be present for compatibility with GridColDef
	defaultValue?: number | number[];
	BIDSType: "NumericArray";
};

export type BIDSNumericArrayColDef<
	TRow extends BIDSRow = BIDSRow,
	TName extends BIDSNumericArrayFieldsNameType = BIDSNumericArrayFieldsNameType
> = Omit<GridColDef<TRow>, "field" | "type"> & BIDSNumericArrayBaseColDef<TName>;

// ^ Column Definitions Map
export type BIDSNumericArrayFieldToColDefType<
	TName extends BIDSNumericArrayFieldsNameType = BIDSNumericArrayFieldsNameType,
	TRow extends BIDSRow = BIDSRow
> = {
	[K in TName]: BIDSNumericArrayColDef<TRow, K>;
};

export const BIDSNumericArrayFieldToColDef: BIDSNumericArrayFieldToColDefType = {
	BackgroundSuppressionPulseTime: {
		field: "BackgroundSuppressionPulseTime",
		headerName: "Background Suppression Pulse Timings (s)",
		BIDSType: "NumericArray",
		editable: true,
		width: 500,
		description: "The timings, in seconds, of the background suppression pulses relative to the start of the labeling.",
		renderEditCell: (params: GridRenderCellParams<any, BIDSRow>) => {
			return (
				<BIDSCommaSepNumericField
					params={params}
					coerceSingleValueToNumber={false}
					shouldSortValues={true}
					uniqueOnly={true}
				/>
			);
		},
		valueFormatter: formatAsCommaSeparatedValues,
		defaultValue: [],
	},
	EchoTime: {
		field: "EchoTime",
		headerName: "Echo Time (s)",
		BIDSType: "NumericArray",
		editable: true,
		width: 210,
		description:
			`The time, in seconds, between the application of the RF excitation pulse and the peak of ` +
			`the signal induced in the receiver coils`,
		renderEditCell: (params: GridRenderCellParams<any, BIDSRow>) => {
			return (
				<BIDSCommaSepNumericField
					params={params}
					coerceSingleValueToNumber={true}
					shouldSortValues={false}
					uniqueOnly={false}
				/>
			);
		},
	},
	PostLabelingDelay: {
		field: "PostLabelingDelay",
		headerName: "Post Labeling Delay (s)",
		BIDSType: "NumericArray",
		editable: true,
		width: 250,
		description:
			`The time, in seconds, after the end of the labeling (for "CASL" or "PCASL") or middle of ` +
			`the labeling pulse (for "PASL") until the middle of the excitation pulse applied to the imaging slab ` +
			`(for 3D acquisition) or first slice (for 2D acquisition). This can either be a single positive number ` +
			`or a comma-separated list of positive numbers for multi-PLD acquisitions.`,
		renderEditCell: (params: GridRenderCellParams<any, BIDSRow>) => {
			return (
				<BIDSCommaSepNumericField
					params={params}
					coerceSingleValueToNumber={true}
					shouldSortValues={false}
					uniqueOnly={false}
				/>
			);
		},
		valueFormatter: formatAsCommaSeparatedValues,
		defaultValue: 1.8,
	},
	LabelingDuration: {
		field: "LabelingDuration",
		headerName: "Labeling Duration (s)",
		BIDSType: "NumericArray",
		editable: true,
		width: 250,
		description:
			"The temporal width, in seconds, of the labeling bolus when using CASL or PCASL. " +
			"Can be either a single positive number or a comma-separated list of positive numbers describing the specific " +
			"labeling durations for each volume in the ASL series. " +
			"This field should be omitted in PASL sequences.",
		renderEditCell: (params: GridRenderCellParams<any, BIDSRow>) => {
			return (
				<BIDSCommaSepNumericField
					params={params}
					coerceSingleValueToNumber={true}
					shouldSortValues={false}
					uniqueOnly={false}
				/>
			);
		},
		valueFormatter: formatAsCommaSeparatedValues,
		defaultValue: 0.8,
	},
	SliceTiming: {
		field: "SliceTiming",
		headerName: "Slice Timing (s)",
		BIDSType: "NumericArray",
		editable: true,
		width: 800,
		description:
			"The time at which each slice was acquired within each volume (frame) of the acquisition. " +
			"Specify either a comma-separated list of numbers, one for each slice, or a single positive number. ",
		renderEditCell: (params: GridRenderCellParams<any, BIDSRow>) => {
			return (
				<BIDSCommaSepNumericField
					params={params}
					coerceSingleValueToNumber={true}
					shouldSortValues={true}
					uniqueOnly={true}
				/>
			);
		},
		valueFormatter: formatAsCommaSeparatedValues,
		defaultValue: 0.03,
	},
};
