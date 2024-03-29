import Button, { ButtonProps } from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper, { PaperProps } from "@mui/material/Paper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper, { StepperProps } from "@mui/material/Stepper";
import React, { useState } from "react";
import { Control, DeepPartial, FieldPath, FieldValues, useForm, UseFormReturn, useFormState } from "react-hook-form";
import * as Yup from "yup";
import { ResolverFactory } from "../../common/utils/formFunctions";

/**
 * Type for the return of `RHFMultiStep`.
 *
 * @return Returns an object equivalent to the return of `useForm` plus the following two properties:
 * - currentStep: The current step of the form.
 * - setCurrentStep: A function that sets the current step of the form.
 */
export type RHFMultiStepReturnProps<TF extends FieldValues> = UseFormReturn<TF> & {
	currentStep: number;
	setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
};

/**
 * Type for a particular step of used by a {@link RHFMultiStepStepper} in order to have awareness of the form's fields
 * in order to render an error state when it occurs at a particular step.
 *
 * ### Mandatory Props
 * - `label`: The label to display for the step.
 * - `fieldNames`: The names of the fields that are rendered in this step and which should be watched in case
 * a validation error occurs within any of them.
 */
export type RHFMultiStepStepProps<TFV extends FieldValues = FieldValues> = {
	label: React.ReactNode;
	fieldNames: FieldPath<TFV>[];
};

export type RHFMultiStepStepperProps<TFV extends FieldValues> = {
	control: Control<TFV>;
	currentStep: number;
	steps: RHFMultiStepStepProps<TFV>[];
} & StepperProps;

export type RHFMultiStepProps<TSchema extends Yup.AnyObjectSchema, TFV extends FieldValues> = {
	schemas: TSchema[];
	defaultValues: DeepPartial<TFV>;
	resolverFactory?: ResolverFactory;
	resolverOptions?: Yup.ValidateOptions<TFV>;
	children: (RHFbag: RHFMultiStepReturnProps<TFV>) => React.ReactElement;
};

/**
 * Higher order component that wraps a form in a react-hook-form coupled with step logic.
 * @param schemas - An array of Schemas to be applied for each step.
 * @param defaultValues - Initial defaultValues to be used for the form.
 * @param resolverFactory - A factory function that returns a resolver function for the form.
 * @param resolverOptions - Options to be passed to the resolver factory.
 * @returns Returns an object equivalent to the return of `useForm` plus the following two properties:
 * - `currentStep`: The current step of the form.
 * - `setCurrentStep`: A function that sets the current step of the form.
 */
export function RHFMultiStep<TSchema extends Yup.AnyObjectSchema, TFV extends FieldValues>({
	schemas,
	defaultValues,
	resolverFactory,
	resolverOptions,
	children,
}: RHFMultiStepProps<TSchema, TFV>) {
	const [step, setStep] = useState(0);
	const currentSchema = schemas[step];
	const resolver = currentSchema != undefined ? resolverFactory(currentSchema, resolverOptions) : undefined;
	const RHFbag = useForm({
		defaultValues: defaultValues,
		resolver,
	});

	return children({ ...RHFbag, currentStep: step, setCurrentStep: setStep });
}

/**
 * Material UI Stepper Component meant to be used in a context with access to the `control`
 * prop returned by react-hook-form 's useForm.
 *
 * # Mandatory Props
 * - `control`: The control object from `useForm`.
 * - `currentStep`: The current step of the form.
 *
 * # Optional Props
 * - `steps`: An array of {@link RHFMultiStepStepProps} objects, each containing the following properties:
 *     - `label`: The label of the step.
 *     - `fieldNames`: An array of field names to be used for the step.
 * - `...StepperProps`: Any other props to be passed to the Material UI Stepper component.
 */
export function RHFMultiStepStepper<TFV extends FieldValues>({
	control,
	currentStep,
	steps,
	...stepperProps
}: RHFMultiStepStepperProps<TFV>) {
	const currentStepNames = steps?.[currentStep]?.fieldNames ?? [];
	const { errors } = useFormState({ control: control, name: currentStepNames });
	const errKeys = Object.keys(errors);

	// console.log(`RHFMultiStepStepper: errKeys`, errKeys);

	return (
		<Stepper {...stepperProps} activeStep={currentStep}>
			{steps.map((step, index) => {
				const errsInCurrentStep = step.fieldNames.some((fieldName) => errKeys.includes(fieldName));
				return (
					<Step key={`${step.label}_${index}`}>
						<StepLabel error={index === currentStep && errsInCurrentStep}>{step.label}</StepLabel>
					</Step>
				);
			})}
		</Stepper>
	);
}

export type RHFMultiStepButtonsProps = {
	currentStep: number;
	setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
	backButtonProps?: ButtonProps;
	nextButtonProps?: ButtonProps;
	backButtonText?: React.ReactNode;
	nextButtonText?: React.ReactNode;
} & PaperProps;

/**
 * Wrapper component for the buttons of the form that is used in tandem with `RHFMultiStep`.
 *
 * ### Mandatory Props
 * - `currentStep`: The current step of the form.
 * - `setCurrentStep`: A function that sets the current step of the form.
 *
 * ### Optional Props
 * - `backButtonProps`: Any props to be passed to the back button.
 * - `nextButtonProps`: Any props to be passed to the next button.
 * - `backButtonText`: The text to be displayed on the back button. Defaults to "Back".
 * - `nextButtonText`: The text to be displayed on the next button. Defaults to "Next".
 * - `...PaperProps`: Any props to be passed to the Material UI Paper container component housing the buttons.
 *
 * @remarks
 * By default, this component is absolutely positioned at the bottom of the form and the buttons are spaced-between.
 */
export function RHFMultiStepButtons({
	currentStep,
	setCurrentStep,
	backButtonProps,
	nextButtonProps,
	backButtonText = "Back",
	nextButtonText = "Next",
	children,
	...paperProps
}: RHFMultiStepButtonsProps) {
	return (
		<Paper
			elevation={10}
			sx={{
				position: "fixed",
				left: 0,
				bottom: 0,
				width: "100%",
				borderRadius: 0,
				display: "flex",
				justifyContent: "space-between",
				zIndex: 10,
			}}
			{...paperProps}
		>
			<Button
				disabled={currentStep === 0}
				size="large"
				onClick={() => setCurrentStep(currentStep - 1)}
				{...backButtonProps}
			>
				{backButtonText}
			</Button>
			<Divider sx={{ borderWidth: 1 }} variant="middle" flexItem orientation="vertical" />
			<Button type="submit" size="large" {...nextButtonProps}>
				{nextButtonText}
			</Button>
			{children}
		</Paper>
	);
}
