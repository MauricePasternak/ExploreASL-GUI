import { cloneDeep, pick as lodashPick, zip as lodashZip } from "lodash";

/**
 * Converts a string Record to a flat array of values comprising of modified & alternative key-value or value-key sequences.
 * @param record An Object whose keys and values are both strings.
 * @param keysPredicate function to apply to the keys of the object before array transformation.
 * @param valuePredicate A function to apply to the values of the object before array transformation.
 * @param keysFirst Whether the zipping of keys and values should be done such that the ordering becomes
 * [key1, value1, key2, value2, ...] (true) or key-value positions flipped (false).
 * @returns An flat array of strings of alternating modified key-value (or value-key) pairs.
 *
 * @example
 * ```ts
 * const testObj = { a: "1", b: "2", c: "3"};
 * console.log(stringRecordToFlatArray(testObj));
 * >>> ["a", "1", "b", "2", "c", "3"]
 *
 * console.log(stringRecordToFlatArray(testObj, null, s => (parseInt(s) + 1000).toString()));
 * >>> ["a", "1001", "b", "1002", "c", "1003"]
 * ```
 *
 */
export function stringRecordToFlatArray(
  record: Record<string, string>,
  keyPredicate?: (s: string, idx?: number, arr?: string[]) => string,
  valuePredicate?: (s: string, idx?: number, arr?: string[]) => string,
  keysFirst = true
) {
  const modifiedKeys = keyPredicate
    ? Object.keys(record).map((k, idx, arr) => keyPredicate(k, idx, arr))
    : Object.keys(record);
  const modifiedValues = valuePredicate
    ? Object.values(record).map((v, idx, arr) => valuePredicate(v, idx, arr))
    : Object.values(record);
  const asFlatArray = keysFirst
    ? lodashZip(modifiedKeys, modifiedValues).flat()
    : lodashZip(modifiedValues, modifiedKeys).flat();
  return asFlatArray;
}

/**
 * Updates Object A from Object B, but only based on keys contained within A.
 * @param object The object which is to be mutated or which creates the template for a clone to be mutated.
 * @param valuesDonor The object which is used to mutate object.
 * @param deep Whether the operation should mutate object (false) or create a new Object via deep cloning (true). Defaults to `false`.
 * @returns Either a mutated Object object (shallow copy) or a completely new Object if deep was true.
 * @example
 * ```ts
 * const A = { a: 1, b: 2 }
 * const B = { b: 3, c: 4 }
 * console.log(assignSelfKeysOnly(A, B))
 * >>> { a: 1, b: 3 }
 * ```
 */
export function assignSelfKeysOnly<T>(
  object: Record<string, T>,
  valuesDonor: Record<string, T>,
  deep = true
): Record<string, T> {
  return Object.assign(deep ? cloneDeep(object) : object, lodashPick(valuesDonor, Object.keys(object)));
}
