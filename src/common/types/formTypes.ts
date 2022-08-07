import { ControllerFieldState, ControllerRenderProps, FieldValues, Path, UseControllerProps } from "react-hook-form";

/**
 * @description An intermediate type to represent the mandatory props to provide every `RHF` prefixed component.
 * These props include:
 * `control`: The controller object returned by a `useForm` hook.
 * `name`: The name of the field that this component is responsible for.
 */
export type UseControllerPropsBaseType<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Required<Pick<UseControllerProps<TValues, TName>, "control" | "name">>;

/**
 * @description Type representing the return of the Controller's render function. Has two properties:
 * - `field`: An object representing the field value, name, and changing handlers.
 * - `fieldState`: An object representing the field state (i.e. errors).
 */
export type ControllerFieldPropType<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = {
  field: ControllerRenderProps<TValues, TName>;
  fieldState: ControllerFieldState;
};

export type FieldValueType<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = TValues[TName];
