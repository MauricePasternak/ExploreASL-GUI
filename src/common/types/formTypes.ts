import {
  Control,
  ControllerFieldState,
  ControllerRenderProps,
  FieldValues,
  Path,
  UseControllerProps,
  UseFormTrigger,
} from "react-hook-form";

/**
 * @description An intermediate type to represent the mandatory props to provide every `RHF` prefixed component.
 * These props include:
 * `control`: The controller object returned by a `useForm` hook.
 * `name`: The name of the field that this component is responsible for.
 */
export type RHFControlAndNameType<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = {
  name: TName;
  control: Control<TValues, any>;
};

/**
 * @description Type representing the return of the Controller's render function. Has two properties:
 * - `field`: An object representing the field value, name, and changing handlers.
 * - `fieldState`: An object representing the field state (i.e. errors).
 */
export type RHFFieldAndFieldStateType<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = {
  field: ControllerRenderProps<TValues, TName>;
  fieldState: ControllerFieldState;
};

/**
 * @description Type representing props that allow for RHF components to trigger the validation of other fields.
 * - `trigger`: The trigger function from React Hook Form's useForm hook return.
 * - `triggerTarget`: The name of the field(s) that should be triggered when the component's value changes.
 */
export type RHFTriggerType<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = {
  trigger: UseFormTrigger<TValues>;
  triggerTarget: TName | TName[];
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
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFControlAndNameType<TValues, TName> & RHFTriggerType<TValues, TName>;

/**
 * @description Type representing the value type of a particular field.
 */
export type RHFFieldValueType<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = TValues[TName];
