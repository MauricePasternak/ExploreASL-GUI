import { ObjectShape } from "yup/lib/object";
import { ValidationError } from "yup";

type ObjectShapeValues = ObjectShape extends Record<string, infer V> ? V : never;
/**
 * More liberal version of Yup.SchemaOf<T> that validates the keys of T but not the values.
 * The original is far too strict on occasion and this is meant to be used as a workaround while ensuring key-safety.
 *
 * @example
 * ```ts
 * const schema = Yup.object().shape<YupShape<T>>>({
 * ...
 * });
 * ```
 */
export type YupShape<T extends Record<any, any>> = Partial<Record<keyof T, ObjectShapeValues>>;

/**
 * Type representing the appropriate return for any schema invoking the `test()` method
 */
export type YupTestReturnType = boolean | ValidationError;
