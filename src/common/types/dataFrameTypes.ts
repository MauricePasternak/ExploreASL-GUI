/**
 * Type representing the dtypes that values in a dataframe can be.
 */
export type DataFrameDtypes = "string" | "number" | "boolean" | "date" | "nullish" | "object" | "array";

export type DataFrameMainType = "Categorical" | "Continuous" | "Ignore";

/**
 * Type representing a mapping of dtypes to the frequencies that they occur in a dataframe.
 */
export type SeriesDTypeFrequencies = Partial<Record<DataFrameDtypes, number>>;

/**
 * Type representing a mapping of column names to either their dtype (if 100% pure) or to a mapping of dtypes
 * to frequencies for that column.
 */
export type DataFrameDTypeMapping = Record<string, DataFrameDtypes | SeriesDTypeFrequencies>;

/**
 * Type representing a mapping of column names to their main type ({@link DataFrameMainType}).
 */
export type DataFrameDTypeMainMapping = Record<string, DataFrameMainType>;

/**
 * Type representing the configuration of a subsetting operation. Has properties:
 * - `funcName`: The name of the function to perform the subsetting operation.
 * - `col`: The column with which to base the subsetting operation around.
 * - `value`: The value to use in the subsetting operation.
 */
export type predicateFormula<T = any> =
  | {
      funcName: "gt" | "ge" | "lt" | "le";
      col: string;
      val: number;
    }
  | {
      funcName: "eq" | "ne" | "weakEQ" | "weakNE" | "includes" | "excludes";
      col: string;
      val: T;
    }
  | {
      funcName: "matches";
      col: string;
      val: RegExp;
    }
  | {
      funcName: "and" | "or";
      col: never;
      val: predicateFormula[];
    };

/**
 * Type representing an operation to change the main datatype of a dataframe.
 */
export type DataFrameChangeDtypeOp = {
  /**
   * The column to change the dtype of.
   */
  col: string;
  /**
   * The new dtype of the column.
   * @see DataFrameMainType
   */
  mainDtype: DataFrameMainType;
};
