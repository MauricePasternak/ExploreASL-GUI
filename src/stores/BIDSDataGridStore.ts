import { atom } from "jotai";
import {
	BIDSAllFieldsNameType,
	BIDSAllNonMiscFieldsNameType,
	BIDSBooleanColDef,
	BIDSBooleanFieldToColDef,
	BIDSEnumColDef,
	BIDSEnumFieldToColDef,
	BIDSNumericColDef,
	BIDSNumericFieldToColDef,
	BIDSRow,
	BIDSTextColDef,
	BIDSTextFieldToColDef,
	isBIDSBooleanField,
	isBIDSEnumField,
	isBIDSField,
	isBIDSNumericField,
	isBIDSTextField,
	isMiscField,
	MiscColDef,
	MiscFieldToColDef,
} from "../pages/BIDSDataGrid/BIDSColumnDefs";

import { pickBy as lodashPickBy } from "lodash";

import { fetchBIDSData } from "../pages/BIDSDataGrid/BIDSDataGridFetching";
import { BIDSErrorAddArg, BIDSErrorMapping } from "../pages/BIDSDataGrid/BIDSErrors";

const { api } = window;

//^ PRIMITIVE ATOMS

/** Atom that holds a validated filepath which will allow for loading the dataframes from this location */
export const atomBIDSStudyRootPath = atom<string>("");

/** Atom that holds the current dataframe data as BIDSRow[] */
export const atomBIDSRows = atom<BIDSRow[]>([]);

/** Atom that holds the current dataframe column names */
export const atomBIDSColumnNames = atom<BIDSAllFieldsNameType[]>([]);

/** Atom that holds the current errors found in the dataframe */
export const atomBIDSErrors = atom<BIDSErrorMapping>({} as BIDSErrorMapping);

/** Primitive atom for controlling the open/closed state of the dialog responsible for adding a new BIDS field */
export const atomBIDSAddColumnDialogOpen = atom(false);

/** Primitive atom for controlling the open/closed state of the dialog responsible for removing a BIDS field */
export const atomBIDSRemoveColumnDialogOpen = atom(false);

// ^ DERIVED ATOMS

/**
 * Derived setter atom for updating the state of the BIDSErrors, either adding or removing errors depending on
 * whether there are any errors in the updateErrorsArg.errors object
 */
export const atomSetBIDSUpdateErrors = atom<null, BIDSErrorAddArg>(null, (get, set, updateErrorsArg) => {
	const { ID, errors: newErrors, bidsRow } = updateErrorsArg;
	const hasErrors = Object.keys(newErrors).length > 0;
	const currentBIDSErrors = get(atomBIDSErrors);

	// console.log("🚀 ~ atomSetBIDSUpdateErrors called with debug:", {
	// 	ID,
	// 	hasErrors,
	// 	newErrors,
	// 	currentBIDSErrors,
	// });

	// If there are errors, we need to do an addition operation
	if (hasErrors) {
		for (const [fieldName, error] of Object.entries(newErrors)) {
			if (!isBIDSField(fieldName)) continue;

			// If the field already exists in the currentBIDSErrors, then we can just push the new error
			if (fieldName in currentBIDSErrors) {
				currentBIDSErrors[fieldName][ID] = error.message!;
			}
			// Otherwise, we need to create a new entry in the currentBIDSErrors
			else {
				currentBIDSErrors[fieldName] = {
					[ID]: error.message!,
				};
			}
		}

		// Jotai requires that we make a copy in order for the update to register
		set(atomBIDSErrors, { ...currentBIDSErrors });
	}
	// Otherwise, we need to do a subtraction operation using the bidsRow
	else {
		for (const fieldName of Object.keys(bidsRow)) {
			if (!isBIDSField(fieldName) || !(fieldName in currentBIDSErrors)) continue;

			// If the field already exists in the currentBIDSErrors, then we can just remove the error
			if (ID in currentBIDSErrors[fieldName]) {
				delete currentBIDSErrors[fieldName][ID];
			}
			// If the field no longer has any errors, then we can remove the field from the currentBIDSErrors
			if (Object.keys(currentBIDSErrors[fieldName]).length === 0) {
				delete currentBIDSErrors[fieldName];
			}
		}

		// Jotai requires that we make a copy in order for the update to register
		set(atomBIDSErrors, { ...currentBIDSErrors });
	}
});

/** Derived setter atom for setting the dataframe from a given filepath */
export const atomSetFetchBIDSDataFrame = atom<null, string>(null, async (get, set, studyRootPath) => {
	// Sanity check -- must be a valid BIDS study root path
	if (!studyRootPath || !((await api.path.getFilepathType(studyRootPath)) === "dir")) return null;

	console.log("🚀 ~ atomSetFetchBIDSDataFrame ~ studyRootPath", studyRootPath);

	// Clean the fetched data
	const fetchResult = await fetchBIDSData(studyRootPath);
	console.log("🚀 ~ file: BIDSDataGridStore.ts:118 ~ atomSetFetchBIDSDataFrame ~ fetchResult", fetchResult);
	if (!fetchResult) return null;

	// TODO -- handle the invalid files in a future update; note that these are basenames
	const { BIDSRows, BIDSColumns, invalidFiles } = fetchResult;

	console.log("🚀 ~ file: BIDSDataGridStore.ts:125 ~ atomSetFetchBIDSDataFrame ~ invalidFiles", invalidFiles);

	// Update the BIDSRows and the BIDSColumnNames atoms
	set(atomBIDSRows, BIDSRows);
	set(atomBIDSColumnNames, Array.from(BIDSColumns));
	set(atomBIDSErrors, {} as BIDSErrorMapping); // Reset the errors
	return true;
});

/** Derived getter atom for determining the current column configs to use on the basis of the column names */
export const atomGetBIDSColumnConfigs = atom<
	Array<MiscColDef | BIDSNumericColDef | BIDSBooleanColDef | BIDSTextColDef | BIDSEnumColDef>
>((get) => {
	const colNames = get(atomBIDSColumnNames);
	// console.log("🚀 ~ file: BIDSDataGridStore.ts:55 ~ colNames", colNames);

	const columnConfigs = colNames
		.map((colName) => {
			if (isMiscField(colName)) {
				const config = MiscFieldToColDef[colName];
				return config;
			} else if (isBIDSNumericField(colName)) {
				const config = BIDSNumericFieldToColDef[colName];
				return config;
			} else if (isBIDSTextField(colName)) {
				const config = BIDSTextFieldToColDef[colName];
				return config;
			} else if (isBIDSEnumField(colName)) {
				const config = BIDSEnumFieldToColDef[colName];
				return config;
			} else if (isBIDSBooleanField(colName)) {
				const config = BIDSBooleanFieldToColDef[colName];
				return config;
			} else {
				return null;
			}
		})
		.filter((config) => config !== null);
	return columnConfigs as Array<MiscColDef | BIDSNumericColDef | BIDSBooleanColDef | BIDSTextColDef | BIDSEnumColDef>;
});

/** Derived setter atom for saving the existing data */
export const atomSetSaveBIDSDataFrame = atom(null, async (get) => {
	const bidsRows = get(atomBIDSRows);
	for await (const row of bidsRows) {
		const { ID, Filepath, Filename, ...bidsData } = row;
		// TODO Logic for verifying that the filepath is valid
		console.log(`🚀 ~ Saving bidsData for ${Filename} to ${Filepath}`);
		// TODO Logic for saving the bidsData to the validated filepath
	}
});

type BIDSAddColumnArgs<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	colToAdd: TName;
	defaultValue: BIDSRow[TName];
};

/** Derived setter atom for adding in a new column to the dataframe */
export const atomSetBIDSAddColumn = atom<null, BIDSAddColumnArgs>(null, (get, set, { colToAdd, defaultValue }) => {
	// Update the existing BIDS rows
	const BIDSRows = get(atomBIDSRows);
	const newBIDSRows: BIDSRow[] = BIDSRows.map((row) => ({ ...row, [colToAdd]: defaultValue }));

	// Update the existing BIDS column names
	const BIDSColumnNames = get(atomBIDSColumnNames);
	const newBIDSColumnNames = [...BIDSColumnNames, colToAdd];

	// TODO Adding a column should cause validation to be re-run on the entire dataframe

	// Update the atoms
	set(atomBIDSRows, newBIDSRows);
	set(atomBIDSColumnNames, newBIDSColumnNames);
});

/** Derived setter atom for removing a given column from the dataframe */
export const atomSetBIDSRemoveColumn = atom(
	null,
	(get, set, colsToRemove: BIDSAllNonMiscFieldsNameType[] | BIDSAllNonMiscFieldsNameType) => {
		// Type stabiliy
		const colsToRemoveSet = new Set(Array.isArray(colsToRemove) ? colsToRemove : [colsToRemove]);

		// Update the existing BIDS rows
		const BIDSRows = get(atomBIDSRows);
		const newBIDSRows: BIDSRow[] = BIDSRows.map((row) => {
			const newRow = lodashPickBy(
				row,
				(_, key) => !colsToRemoveSet.has(key as BIDSAllNonMiscFieldsNameType)
			) as BIDSRow;
			console.log("🚀 ~ file: BIDSDataGridStore.ts:151 ~ constnewBIDSRows:BIDSRow[]=BIDSRows.map ~ newRow", newRow);
			return newRow;
		});

		// Update the existing BIDS column names
		const BIDSColumnNames = get(atomBIDSColumnNames);
		const newBIDSColumnNames = BIDSColumnNames.filter(
			(colName) => !colsToRemoveSet.has(colName as BIDSAllNonMiscFieldsNameType)
		);

		// Update the existing errors, if any
		const BIDSRowErrors = get(atomBIDSErrors);
		const newBIDSRowErrors = lodashPickBy(
			BIDSRowErrors,
			(_, key) => !colsToRemoveSet.has(key as BIDSAllNonMiscFieldsNameType)
		);

		// Update the atoms
		set(atomBIDSRows, newBIDSRows);
		set(atomBIDSColumnNames, newBIDSColumnNames);
		set(atomBIDSErrors, newBIDSRowErrors as BIDSErrorMapping);
	}
);

/** Derived setter atom for updating the dataframe from a provided new row */
export const atomSetBIDSUpdateDataFrameFromRow = atom(null, (get, set, newRow: BIDSRow) => {
	const BIDSRows = get(atomBIDSRows);
	const newBIDSRows = BIDSRows.map((row) => (row.ID === newRow.ID ? newRow : row));
	set(atomBIDSRows, newBIDSRows);
});

type BIDSUpdateFromCellArgs<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	ID: number;
	colName: BIDSAllFieldsNameType;
	value: BIDSRow[TName];
};

/** Derived setter atom for updating the dataframe at a particular cell */
export const atomSetBIDSUpdateDataFrameFromCell = atom<null, BIDSUpdateFromCellArgs>(
	null,
	(get, set, { ID, colName, value }) => {
		const BIDSRows = get(atomBIDSRows);
		const newBIDSRows = BIDSRows.map((row) => (row.ID === ID ? { ...row, [colName]: value } : row));
		set(atomBIDSRows, newBIDSRows);
	}
);
