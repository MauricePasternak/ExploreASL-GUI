import { FieldError } from "react-hook-form";
import { BIDSAllFieldsNameType, BIDSRow } from "./BIDSColumnDefs";

/** Type representing all the cells errors found in a particular row */
type BIDSRowErrors = Record<number, string>;

export type BIDSErrorMapping<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	[key in TName]: BIDSRowErrors;
};

/** Type representing the argument necessary to update the state of the known errors within the dataframe */
export type BIDSErrorAddArg<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	ID: number;
	errors: Record<TName, FieldError>;
	bidsRow: BIDSRow;
};
