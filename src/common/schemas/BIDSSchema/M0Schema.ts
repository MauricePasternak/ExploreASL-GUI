import * as Yup from "yup";

/** Minimal schema to ensure M0Type is an **optiona** string enum */
export const SchemaMin_M0Type = Yup.string()
	.typeError(`M0 Type must be one of the following: "Separate", "Included", "Absent", "Estimate`)
	.oneOf(
		["Separate", "Included", "Absent", "Estimate"],
		`M0 Type must be one of the following: "Separate", "Included", "Absent", "Estimate`
	);

/** Expanded schema for M0Type to ensure it is also required */
export const Schema_M0Type = SchemaMin_M0Type.required("M0 Type is a required field");

export const SchemaMin_M0Estimate = Yup.number()
	.positive("M0 Estimate must be a positive number")
	.typeError(`M0 Estimate must be a number if provided`);

export const Schema_M0Estimate = Yup.mixed().when("M0Type", {
	is: "Estimate",
	then: () => SchemaMin_M0Estimate.required(`M0 Estimate is a required field when M0 Type is "Estimate"`),
	otherwise: () => SchemaMin_M0Estimate,
});

/**
 * Minimal schema for M0-related fields (M0Type, M0Estimate)
 * These cover the minimal requirement for being placeable into input fields like BIDSDataGrid
 */
export const SchemaMin_M0Fields = Yup.object().shape({
	M0Type: SchemaMin_M0Type,
	M0Estimate: SchemaMin_M0Estimate,
});

/**
 * Full schema for M0-related fields (M0Type, M0Estimate)
 * Thse fields are interdependent.
 */
export const Schema_M0Fields = Yup.object().shape({
	M0Type: Schema_M0Type,
	M0Estimate: Schema_M0Estimate,
});
