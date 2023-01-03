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
import React from "react";
import { Controller, useWatch } from "react-hook-form";
import { DebouncedSlider } from "../../../components/DebouncedComponents";
import { parseFieldError } from "../../../common/utils/formFunctions";
/**
 * Necessary wrapper around the BolusCutOffDelayTime field in the Import Module due to its more complex behavior
 * in responding to other fields changing.
 */
export function BolusCutOffDelayTimeSlider({ control, contextIndex, setFieldValue }) {
    const [BolusCutOffTechnique, BolusCutOffDelayTime] = useWatch({
        control,
        name: [
            `ImportContexts.${contextIndex}.BolusCutOffTechnique`,
            `ImportContexts.${contextIndex}.BolusCutOffDelayTime`,
        ],
    });
    if (BolusCutOffTechnique === "Q2TIPS" && !Array.isArray(BolusCutOffDelayTime)) {
        setFieldValue(`ImportContexts.${contextIndex}.BolusCutOffDelayTime`, [0, BolusCutOffDelayTime]);
    }
    else if (BolusCutOffTechnique !== "Q2TIPS" && Array.isArray(BolusCutOffDelayTime)) {
        setFieldValue(`ImportContexts.${contextIndex}.BolusCutOffDelayTime`, BolusCutOffDelayTime[1]);
    }
    console.log(`BolusCutOffDelayTimeSlider from context ${contextIndex} will render children with the following settings:`, JSON.stringify({ BolusCutOffTechnique, BolusCutOffDelayTime }, null, 2));
    return (React.createElement(Controller, { control: control, name: `ImportContexts.${contextIndex}.BolusCutOffDelayTime`, render: ({ field, fieldState }) => {
            const hasError = !!fieldState.error;
            const errorMessage = hasError ? parseFieldError(fieldState.error) : "";
            const { ref } = field, fieldRemainer = __rest(field, ["ref"]);
            return (React.createElement(DebouncedSlider, Object.assign({}, fieldRemainer, { label: "Bolus Cut-Off Delay Time", error: hasError, errorMessage: errorMessage, renderTextfields: true, min: 0, max: 3, step: 0.001, textFieldProps: { sx: { minWidth: 100 }, inputRef: ref } })));
        } }));
}
//# sourceMappingURL=BolusCutOffDelayTimeSlider.js.map