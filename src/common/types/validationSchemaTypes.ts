import { FieldPath, FieldPathValue, FieldValues } from "react-hook-form";
import { ValidationError, ObjectShape, TestContext } from "yup";
import { ParentPathValue } from "./formTypes";

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

type YupTestReturnType = boolean | ValidationError;

type YupHelper<TFV extends FieldValues, TName extends FieldPath<TFV>> = Omit<TestContext<TFV>, "path" | "parent"> & {
	path: TName;
	parent: ParentPathValue<TFV, TName>;
};

export type YupTestFunction<TFV extends FieldValues, TName extends FieldPath<TFV>> = (
	...[value, helpers]: [FieldPathValue<TFV, TName>, YupHelper<TFV, TName>]
) => YupTestReturnType | Promise<YupTestReturnType>;
