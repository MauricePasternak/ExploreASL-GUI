var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import React, { useState } from "react";
import { useForm, useFormState } from "react-hook-form";
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
export function RHFMultiStep({ schemas, defaultValues, resolverFactory, resolverOptions, children, }) {
    const [step, setStep] = useState(0);
    const currentSchema = schemas[step];
    const resolver = currentSchema != undefined ? resolverFactory(currentSchema, resolverOptions) : undefined;
    const RHFbag = useForm({
        defaultValues: defaultValues,
        resolver,
    });
    return children(Object.assign(Object.assign({}, RHFbag), { currentStep: step, setCurrentStep: setStep }));
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
export function RHFMultiStepStepper(_a) {
    var _b, _c;
    var { control, currentStep, steps } = _a, stepperProps = __rest(_a, ["control", "currentStep", "steps"]);
    const currentStepNames = (_c = (_b = steps === null || steps === void 0 ? void 0 : steps[currentStep]) === null || _b === void 0 ? void 0 : _b.fieldNames) !== null && _c !== void 0 ? _c : [];
    const { errors } = useFormState({ control: control, name: currentStepNames });
    const errKeys = Object.keys(errors);
    // console.log(`RHFMultiStepStepper: errKeys`, errKeys);
    return (React.createElement(Stepper, Object.assign({}, stepperProps, { activeStep: currentStep }), steps.map((step, index) => {
        const errsInCurrentStep = step.fieldNames.some((fieldName) => errKeys.includes(fieldName));
        return (React.createElement(Step, { key: `${step.label}_${index}` },
            React.createElement(StepLabel, { error: index === currentStep && errsInCurrentStep }, step.label)));
    })));
}
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
export function RHFMultiStepButtons(_a) {
    var { currentStep, setCurrentStep, backButtonProps, nextButtonProps, backButtonText = "Back", nextButtonText = "Next", children } = _a, paperProps = __rest(_a, ["currentStep", "setCurrentStep", "backButtonProps", "nextButtonProps", "backButtonText", "nextButtonText", "children"]);
    return (React.createElement(Paper, Object.assign({ elevation: 10, sx: {
            position: "fixed",
            left: 0,
            bottom: 0,
            width: "100%",
            borderRadius: 0,
            display: "flex",
            justifyContent: "space-between",
            zIndex: 10,
        } }, paperProps),
        React.createElement(Button, Object.assign({ disabled: currentStep === 0, size: "large", onClick: () => setCurrentStep(currentStep - 1) }, backButtonProps), backButtonText),
        React.createElement(Divider, { sx: { borderWidth: 1 }, variant: "middle", flexItem: true, orientation: "vertical" }),
        React.createElement(Button, Object.assign({ type: "submit", size: "large" }, nextButtonProps), nextButtonText),
        children));
}
//# sourceMappingURL=RHFMultiStep.js.map