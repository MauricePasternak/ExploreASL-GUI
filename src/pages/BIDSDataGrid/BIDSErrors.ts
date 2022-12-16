import { FieldError } from "react-hook-form";
import { BIDSAllFieldsNameType, BIDSRow } from "./BIDSColumnDefs";

/**
 * Type representing all the cells errors found in a particular row.
 *
 * - Keys are the row IDs (numbers)
 * - Values are the error messages (strings)
 */
type BIDSRowErrors = Record<number, string>;

/**
 * Type representing a mapping of BIDSFieldnames to errors. This is an object whose:
 *
 * - Keys are the names of the BIDS fields
 * - Values are objects (of type {@link BIDSRowErrors}) whose:
 * 	- Keys are the row IDs (numbers) of the rows with errors
 * 	- Values are the error messages (strings)
 */
export type BIDSErrorMapping<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	[key in TName]: BIDSRowErrors;
};

/** Type representing the argument necessary to update the state of the known errors within the dataframe */
export type BIDSErrorAddArg<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	ID: number;
	errors: Record<TName, FieldError>;
	bidsRow: BIDSRow;
};
