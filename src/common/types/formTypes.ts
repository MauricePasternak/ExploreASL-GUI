import { Control, FieldPathValues, FieldValues, FieldPath, FieldPathValue, UseFormTrigger } from "react-hook-form";

/**
 * @description An intermediate type to represent the mandatory props to provide every `RHF` prefixed component.
 * These props include:
 * - `control`: The controller object returned by a `useForm` hook.
 * - `name`: The name of the field that this component is responsible for.
 */
export type RHFControlAndNameType<TFV extends FieldValues, TName extends FieldPath<TFV> = FieldPath<TFV>> = {
	name: TName;
	control: Control<TFV, any>;
};

/**
 * Modified version of UseControllerProps from react-hook-form to allow for custom field values.
 * Features the following props:
 * - `name`: path/name of the field
 * - `control`: the form control object from react-hook-form
 */
export type RHFControllerProps<TFV extends FieldValues, TName extends FieldPath<TFV>> = {
	name: TName;
	control: Control<TFV, any>;
};

/**
 * @description Type representing props that allow for RHF components to trigger the validation of other fields.
 * - `trigger`: The trigger function from React Hook Form's useForm hook return.
 * - `triggerTarget`: The name of the field(s) that should be triggered when the component's value changes.
 */
export type RHFTriggerProps<TFV extends FieldValues, TName extends FieldPath<TFV>> =
	| {
			trigger: UseFormTrigger<TFV>;
			triggerTarget: TName | TName[];
	  }
	| {
			trigger?: undefined;
			triggerTarget?: undefined;
	  };

/**
 * @description Type representing the exact type that a field represents.
 * - If that field is an array, then the type will be a union of the types of the array's elements
 * - Otherwise, it will be the type of the field.
 */
export type SingleFieldValueType<
	TFV extends FieldValues,
	TName extends FieldPath<TFV> | readonly FieldPath<TFV>[]
> = TName extends ReadonlyArray<any>
	? FieldPathValues<TFV, TName>
	: TName extends FieldPath<TFV>
	? FieldPathValue<TFV, TName>
	: never;

/**
 * Props dedicated to responding to changes in another field
 * Features the following props:
 * - `watchTarget`: The field that should be watched by this component in order to determine whether it should render.
 * - `onWatchedChange`: A function that should take in the value of the watched field and return a boolean on whether
 * the component using this prop should render.
 */
export type RHFWatchProps<TFV extends FieldValues, TName extends FieldPath<TFV> | readonly FieldPath<TFV>[]> =
	| {
			watchTarget: TName;
			onWatchedChange: (watchedValue: SingleFieldValueType<TFV, TName>) => boolean;
	  }
	| {
			watchTarget?: undefined;
			onWatchedChange?: undefined;
	  };

/**
 * @description Wrapper type around {@link RHFControlAndNameType} and {@link RHFTriggerType}.
 * Has props:
 * - `control`: The controller object returned by a `useForm` hook.
 * - `name`: The name of the field that this component is responsible for.
 * - `trigger`: The trigger function from React Hook Form's useForm hook return.
 * - `triggerName`: The name of the field(s) that should be triggered when the component's value changes.
 */
export type RHFInterDepBaseProps<
	TFV extends FieldValues,
	TName extends FieldPath<TFV> = FieldPath<TFV>
> = RHFControlAndNameType<TFV, TName> & RHFTriggerProps<TFV, TName>;
