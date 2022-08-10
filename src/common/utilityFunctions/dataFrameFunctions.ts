/**
 * THIS IS A COMMON MODULE. DO NOT IMPORT ANY SPECIFIC FRONTEND OR BACKEND FUNCTIONS INTO THIS FILE.
 * ONLY EXPORT OUT TO OTHER FILES.
 */
import { DataFrame, IDataFrame, Series, ISeries } from "data-forge";
import {
  isObject as lodashIsObject,
  overEvery as lodashOverEvery,
  overSome as lodashOverSome,
  pick as lodashPick,
} from "lodash";
import {
  DataFrameDTypeMapping,
  DataFrameDtypes,
  predicateFormula,
  SeriesDTypeFrequencies,
} from "../types/dataFrameTypes";

function gt(col: string, val: number) {
  return (row: any) => row[col] > val;
}

function ge(col: string, val: number) {
  return (row: any) => row[col] >= val;
}

function lt(col: string, val: number) {
  return (row: any) => row[col] < val;
}

function le(col: string, val: number) {
  return (row: any) => row[col] <= val;
}

function eq(col: string, val: any) {
  return (row: any) => row[col] === val;
}

function ne(col: string, val: any) {
  return (row: any) => row[col] !== val;
}

function weakEQ(col: string, val: any) {
  return (row: any) => row[col] == val;
}

function weakNE(col: string, val: any) {
  return (row: any) => row[col] != val;
}

function includes(col: string, val: any) {
  return (row: any) => (Array.isArray(val) ? val.includes(row[col]) : [val].includes(row[col]));
}

function excludes(col: string, val: any) {
  return (row: any) => (Array.isArray(val) ? !val.includes(row[col]) : ![val].includes(row[col]));
}

function matches(col: string, val: RegExp) {
  return (row: any) => val.test(row[col]);
}

/**
 * Creates a single AND predicate from an array of instructions.
 * @param formulae An array of predicateFormula objects which are intersected to make a single AND predicate. Each formula is:
 * - `funcName`: A string denoting the comparator function to perform.
 * - `col`: The column to which the selector applies to.
 * - `val`: The value to feed for a particular filter for the indicated column.
 */
export function makeAndPredicate(formulae: predicateFormula[]) {
  const predicates: ((row: any) => boolean)[] = formulae.map(formula => {
    switch (formula.funcName) {
      case "gt":
        return gt(formula.col, formula.val);
      case "ge":
        return ge(formula.col, formula.val);
      case "lt":
        return lt(formula.col, formula.val);
      case "le":
        return le(formula.col, formula.val);
      case "eq":
        return eq(formula.col, formula.val);
      case "ne":
        return ne(formula.col, formula.val);
      case "weakEQ":
        return weakEQ(formula.col, formula.val);
      case "weakNE":
        return weakNE(formula.col, formula.val);
      case "includes":
        return includes(formula.col, formula.val);
      case "excludes":
        return excludes(formula.col, formula.val);
      case "matches":
        return matches(formula.col, formula.val);
      case "and":
        return makeAndPredicate(formula.val);
      case "or":
        return makeOrPredicate(formula.val);
      default:
        throw new Error("Incompatible argument given for the funcName in makeAndPredicate");
    }
  });
  return lodashOverEvery(predicates);
}

/**
 * Creates a single OR predicate from an array of instructions.
 * @param formulae An array of predicateFormula objects which are intersected to make a single OR predicate. Each formula is:
 * - `funcName`: A string denoting the comparator function to perform.
 * - `col`: The column to which the selector applies to.
 * - `val`: The value to feed for a particular filter for the indicated column.
 */
export function makeOrPredicate(formulae: predicateFormula[]) {
  const predicates: ((row: any) => boolean)[] = formulae.map(formula => {
    switch (formula.funcName) {
      case "gt":
        return gt(formula.col, formula.val);
      case "ge":
        return ge(formula.col, formula.val);
      case "lt":
        return lt(formula.col, formula.val);
      case "le":
        return le(formula.col, formula.val);
      case "eq":
        return eq(formula.col, formula.val);
      case "ne":
        return ne(formula.col, formula.val);
      case "weakEQ":
        return weakEQ(formula.col, formula.val);
      case "weakNE":
        return weakNE(formula.col, formula.val);
      case "includes":
        return includes(formula.col, formula.val);
      case "excludes":
        return excludes(formula.col, formula.val);
      case "matches":
        return matches(formula.col, formula.val);
      case "and":
        return makeAndPredicate(formula.val);
      case "or":
        return makeOrPredicate(formula.val);
      default:
        throw new Error("Incompatible argument given for the funcName in makeOrPredicate");
    }
  });
  return lodashOverSome(predicates);
}

/**
 *
 * @param df The dataForge DataFrame object to query.
 * @param formulae
 * An array of predicateFormula objects which are intersected to make a single AND predicate used to filter the dataframe. Each formula is:
 * * `funcName`: A string denoting the comparator function to perform. Current functions include:
 *     * `gt` - Greater than
 *     * `ge` - Greater than or equal to
 *     * `lt` - Less than
 *     * `le` - Less than or equal to
 *     * `eq` - Equal to
 *     * `ne` - Not equal to
 *     * `weakEQ` - Weak equality (==)
 *     * `weakNE` - Weak inequality (!=)
 *     * `includes` - Includes (inclusive)
 *     * `excludes` - Excludes (inclusive)
 *     * `matches` - Matches a regular expression
 *     * `and` - Logical AND
 *     * `or` - Logical OR
 * - `col`: The column to which the selector applies to.
 * - `val`: The value to feed for a particular filter for the indicated column.
 */
export function query(df: IDataFrame, formulae: predicateFormula[]) {
  return df.where(makeAndPredicate(formulae));
}

/**
 * Determines whether a string Series is actually numeric.
 * @param series The dataForge series object.
 * @param NaNThreshold The number of NaNs (null | undefined) to be reached before a series of numbers is no longer considered as such. Defaults to positive infinity.
 */
export function isNumericSeries(series: ISeries, NaNThreshold = Number.POSITIVE_INFINITY) {
  const typeCounts = { NaN: 0, Integer: 0, Float: 0, Other: 0 };
  for (const value of series) {
    if (value == null) typeCounts.NaN++;
    else if (/^\d+$/.test(`${value}`)) typeCounts.Integer++;
    else if (/^\d+\.\d+$/.test(`${value}`)) typeCounts.Float++;
    else return false;
  }
  if (typeCounts.Integer === 0 && typeCounts.Float === 0) return false;
  if (typeCounts.Float > 0) {
    return typeCounts.NaN < NaNThreshold ? "Float" : false;
  } else {
    return typeCounts.NaN < NaNThreshold ? "Integer" : false;
  }
}

/**
 * Coerces a string Series into a number-based one.
 * @param series The dataForge series object.
 * @param numericType The type of numeric column this should be parsed into; `"Integer"` or `"Float"`.
 */
export function toNumericSeries(series: ISeries, numericType: "Integer" | "Float" = "Float") {
  const newSeries = series.map(v => (v == null ? "" : `${v}`));
  return numericType === "Integer" ? newSeries.parseInts() : newSeries.parseFloats();
}

/**
 * Coerces a numeric Series into a string-based one.
 * @param series The dataForge series object.
 */
export function toStringSeries(series: ISeries) {
  return series.map(v => (v == null ? "" : `${v}`));
}

/**
 * Parses a dataframe and
 * @param df The dataforge DataFrame object.
 * @param NaNThreshold The number of NaNs (null | undefined) to be reached before a series of numbers is no longer considered as such. Defaults to positive infinity.
 */
export function castNumeric(df: IDataFrame | DataFrame, NaNThreshold = Number.POSITIVE_INFINITY) {
  const newSeriesMapping = {} as Record<string, ISeries>;

  for (const freq of df.detectTypes()) {
    if (freq.Type === "number" && freq.Frequency === 100) continue;
    const series = df.getSeries(freq.Column);
    const dtype = isNumericSeries(series, NaNThreshold);
    if (!dtype) continue;
    newSeriesMapping[freq.Column] = toNumericSeries(series, dtype);
  }
  return df.withSeries(newSeriesMapping);
}

export function innerJoin(left: DataFrame | IDataFrame, right: DataFrame | IDataFrame, on: string | string[]) {
  return left.join(
    right,
    left_df => (Array.isArray(on) ? on.map(n => left_df[n]) : [left_df[on]]),
    right_df => (Array.isArray(on) ? on.map(n => right_df[n]) : [right_df[on]]),
    (left_df, right_df) => {
      // console.log("LEFT:", left_df);
      // console.log("RIGHT:", right_df);
      return { ...left_df, ...right_df };
    }
  );
}

export function outerLeftJoin(left: DataFrame, right: DataFrame, on: string | string[]) {
  const rightCols = right.getColumnNames();

  return left
    .joinOuterLeft(
      right,
      left_df => (Array.isArray(on) ? on.map(n => left_df[n]) : [left_df[on]]),
      right_df => (Array.isArray(on) ? on.map(n => right_df[n]) : [right_df[on]]),
      (left_df, right_df) => {
        // console.log("LEFT:", left_df);
        // console.log("RIGHT:", right_df);

        // If the right side is null, then we need to fill in the missing columns with nulls.
        if (!right_df) {
          const nullMap = Array.isArray(on) ? on.reduce((acc, n) => ({ ...acc, [n]: null }), {}) : { [on]: null };
          const merged_alt = { ...Object.fromEntries(rightCols.map(c => [c, null])), ...left_df, ...nullMap };
          // console.log("MERGED_ALT:", merged_alt);
          // console.log("\n");
          return merged_alt;
        }

        const merged = { ...left_df, ...right_df };
        // console.log("MERGED:", merged);
        // console.log("\n");

        return merged;
      }
    )
    .filter(row => (Array.isArray(on) ? on.every(n => row[n] != null) : row[on] != null));
}

export function outerJoin(left: DataFrame, right: DataFrame, on: string | string[]) {
  return left.joinOuter(
    right,
    left_df => (Array.isArray(on) ? on.map(n => left_df[n]) : [left_df[on]]),
    right_df => (Array.isArray(on) ? on.map(n => right_df[n]) : [right_df[on]]),
    (left_df, right_df) => {
      // console.log("LEFT:", left_df);
      // console.log("RIGHT:", right_df);
      return { ...left_df, ...right_df };
    }
  );
}

/**
 * Drops all rows that contain null/undefined values.
 * @param df The dataForge dataframe object.
 * @param cols The columns that should be taken into account when filtering out rows with null/undefined values. Defaults to all columns.
 */
export function dropNA(df: IDataFrame, cols?: string[]) {
  const subset = cols ?? df.getColumnNames();
  return df.filter(row => {
    return subset.every(col => row[col] != null);
  });
}

/**
 * Detects the data types of a series.
 * @param series The dataForge series object.
 * @returns Either a string representing the data type of the series (if 100% of the values are of that type) or a
 * mapping of data types to their frequencies.
 */
export function getColumnDtypeFreq(series: ISeries | Series) {
  let dtypeFrequencies: SeriesDTypeFrequencies = {
    string: 0,
    number: 0,
    boolean: 0,
    date: 0,
    nullish: 0,
    object: 0,
    array: 0,
  };

  // Iterate over the values in the series and increment the frequency of the dtype of the value.
  let count = 0;
  for (const value of series) {
    count++;
    if (value == null) {
      dtypeFrequencies.nullish++;
    } else if (typeof value === "string") {
      dtypeFrequencies.string++;
    } else if (typeof value === "number") {
      dtypeFrequencies.number++;
    } else if (typeof value === "boolean") {
      dtypeFrequencies.boolean++;
    } else if (Array.isArray(value)) {
      dtypeFrequencies.array++;
    } else if (value instanceof Date) {
      dtypeFrequencies.date++;
    } else if (lodashIsObject(value)) {
      dtypeFrequencies.object++;
    }
  }

  // Filter out the zero frequencies
  dtypeFrequencies = Object.entries(dtypeFrequencies).reduce((acc, [key, value]) => {
    if (value > 0) {
      acc[key as DataFrameDtypes] = (value / count) * 100;
    }
    return acc;
  }, {} as SeriesDTypeFrequencies);

  // Either return the dtype name if 100% of the values are of that type or return the mapping of dtypes to frequencies.
  const freqNames = Array.from(Object.keys(dtypeFrequencies));
  return freqNames.length > 1 ? dtypeFrequencies : (freqNames[0] as DataFrameDtypes);
}

/**
 * Detects the data types of a dataframe. A more exhaustive version of `detectTypes`.
 * @param df The dataForge dataframe object.
 * @returns An object whose keys are columns names and values are the either a string representing the data type
 * of the series (if 100% of the values are of that type; {@link DataFrameDtypes}) or a mapping of the data types
 * to their frequencies.
 */
export function getDataFrameDtypes(df: IDataFrame | DataFrame) {
  const dtypes = {} as DataFrameDTypeMapping;
  for (const col of df.getColumnNames()) {
    dtypes[col] = getColumnDtypeFreq(df.getSeries(col));
  }
  return dtypes;
}

/**
 * Filters a dataframe to exhibit pure data types.
 * @param dtypes The object returned by `getDtypes`.
 * @param df The dataframe to be resolved, if necessary.
 * @returns An Object with the following properties:
 * - `resolveDtypes`: A modified `dtypes` object with columns converted to pure data types where possible.
 * - `dataFrame`: The resolved dataframe.
 * - `droppedColumns`: An array of columns that were dropped from the dataframe.
 */
export function resolveDtypes(dtypes: DataFrameDTypeMapping, df: IDataFrame | DataFrame) {
  const resolved = {} as Record<string, ISeries>;
  const toDrop = [] as string[];

  for (const [colName, dtype] of Object.entries(dtypes)) {
    if (typeof dtype === "string") continue;

    const series = df.getSeries(colName);
    const numericType = isNumericSeries(series);
    if (numericType) {
      resolved[colName] = toNumericSeries(series, numericType);
      dtypes[colName] = "number";
    } else if (dtype.string > 50) {
      resolved[colName] = toStringSeries(series);
      dtypes[colName] = "string";
    } else {
      toDrop.push(colName);
    }
  }
  return {
    resolvedDTypes: dtypes,
    dataFrame: df.withSeries(resolved).dropSeries(toDrop),
    droppedColumns: toDrop,
  };
}

/**
 * Wrapper function to allow manipulation of a dataframe and return a new DataFrame instance from the series of
 * manipulations.
 * @param df The dataframe to be operated on.
 * @param callback The callback to apply to the dataframe. It is expected to return an IDataFrame.
 * @returns A new dataframe with the result of the callback.
 */
export function handleDataframe(df: DataFrame, callback: (frame: DataFrame, ...args: unknown[]) => IDataFrame) {
  return new DataFrame(callback(df).toArray());
}

export function toNivoScatterPlotDataSingle(df: DataFrame, x: string, y: string, ...other: string[]) {
  const data = df
    .subset([x, y, ...other])
    .toArray()
    .map(obj => ({ x: obj[x], y: obj[y], ...lodashPick(obj, other) }));
  return [{ id: y, data }];
}

export function toNivoScatterPlotDataGroupBy(df: DataFrame, x: string, y: string, group: string, ...other: string[]) {
  const groupBy = df.subset([x, y, group, ...other]).groupBy(selector => selector[group]);
  const result = [];

  for (const groupDF of groupBy) {
    const groupName = groupDF.getSeries(group).first();
    const data = groupDF.toArray().map(obj => ({ ...lodashPick(obj, other), x: obj[x], y: obj[y] }));
    result.push({ id: groupName, data });
  }
  return result;
}

export function toNivoSwarmPlotDataSingle(df: DataFrame, id: string, value: string, ...other: string[]) {
  const data = df
    .subset([id, value, ...other])
    .toArray()
    .map(obj => ({ ...lodashPick(obj, other), id: obj[id], value: obj[value], group: "All Groups" }));
  return ["All Groups", data] as const;
}

export function toNivoSwarmPlotDataGroupBy(
  df: DataFrame,
  id: string | string[],
  value: string,
  group: string,
  ...other: string[]
) {
  console.log(`toNivoSwarmPlotDataGroupBy invoked with id: ${id}, value: ${value}, group: ${group}, other: ${other}`);

  const groups = df.getSeries(group).distinct().toArray();
  const iid = Array.isArray(id) ? id : [id];
  const data = df
    .subset([...iid, value, group, ...other])
    .toArray()
    .map(obj => {
      const groupName = obj[group];
      // const result = { ...lodashPick(obj, other), id: obj[id], value: obj[value], group: groupName };
      // return result;
      return {
        ...lodashPick(obj, other),
        id: Array.isArray(id) ? `${obj[id[0]]}_${obj[id[1]]}` : obj[id],
        value: obj[value],
        group: groupName,
      };
    });
  return [groups, data] as const;
}
