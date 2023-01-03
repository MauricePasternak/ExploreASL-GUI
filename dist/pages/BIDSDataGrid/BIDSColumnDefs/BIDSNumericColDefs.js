import React from "react";
import { BIDSSingleNumberField } from "../BIDSDataGridCellComponents/BIDSSingleNumberField";
import { BIDSFlexibleNumberField, switchBIDSNumericType } from "../BIDSDataGridCellComponents/BIDSFlexibleNumberField";
function formatAsCommaSeparatedValues(params) {
    if (params.value != null)
        return Array.isArray(params.value) ? params.value.join(", ") : params.value;
    return "";
}
// ^ Field Names
export const BIDSNumericFields = [
    "BackgroundSuppressionNumberPulses",
    "BolusCutOffDelayTime",
    "FlipAngle",
    "InversionTime",
    "MagneticFieldStrength",
    "M0Estimate",
    "M0_GMScaleFactor",
    "RepetitionTimePreparation",
    "TotalAcquiredPairs",
    "TotalReadoutTime",
];
export const BIDSNumericFieldsSet = new Set(BIDSNumericFields);
// ^ Type Guard
export function isBIDSNumericField(fieldName) {
    return BIDSNumericFieldsSet.has(fieldName);
}
export const BIDSNumericFieldToColDef = {
    BackgroundSuppressionNumberPulses: {
        field: "BackgroundSuppressionNumberPulses",
        headerName: "Background Suppression Number of Pulses",
        BIDSType: "Numeric",
        editable: true,
        width: 330,
        min: 0,
        max: 100,
        step: 1,
        description: `The number of background suppression pulses used for the ASL scan. ` +
            `Note that this excludes any effect of background suppression pulses applied before the labeling.`,
        renderEditCell: (params) => {
            return React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 0, inputProps: { min: 0, max: 100, step: 1 } });
        },
    },
    BolusCutOffDelayTime: {
        field: "BolusCutOffDelayTime",
        headerName: "Bolus Cut Off Delay Time (s)",
        BIDSType: "Numeric",
        editable: true,
        width: 240,
        min: 0,
        max: 10,
        step: 0.001,
        description: `Duration between the end of the labeling and the start of the bolus cut-off ` +
            `saturation pulse(s), in seconds. For Q2TIPS, this is a collection of two numbers that correspond to ` +
            `the first and last saturation pulses given`,
        valueFormatter: formatAsCommaSeparatedValues,
        valueSetter: (params) => {
            var _a;
            const { value, row } = params;
            console.log("🚀 ~ file: BIDSNumericColDefs.tsx ~ BolusCutOffDelayTime ~ valueSetter ~ value", value);
            const shouldRenderMulti = ((_a = params.row) === null || _a === void 0 ? void 0 : _a.BolusCutOffTechnique) === "Q2TIPS";
            const newValue = switchBIDSNumericType(value, shouldRenderMulti, 2, 0);
            console.log("🚀 ~ file: BIDSNumericColDefs.tsx ~ BolusCutOffDelayTime ~ valueSetter ~ newvalue", newValue);
            return Object.assign(Object.assign({}, row), { BolusCutOffDelayTime: newValue });
        },
        renderEditCell: (params) => {
            return (React.createElement(BIDSFlexibleNumberField, Object.assign({}, params, { min: 0, max: 10, step: 0.001, numberFieldsWhenMulti: 2, defaultValue: 0, shouldRenderMultiNumeric: (params) => {
                    var _a;
                    return ((_a = params.row) === null || _a === void 0 ? void 0 : _a.BolusCutOffTechnique) === "Q2TIPS";
                } })));
        },
    },
    FlipAngle: {
        field: "FlipAngle",
        headerName: "Flip Angle (deg)",
        BIDSType: "Numeric",
        editable: true,
        width: 135,
        min: 0,
        max: 360,
        step: 0.1,
        description: `The angle, in degrees, of the RF excitation pulse`,
        renderEditCell: (params) => {
            return React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 0, inputProps: { min: 0, max: 360, step: 0.1 } });
        },
    },
    InversionTime: {
        field: "InversionTime",
        headerName: "Inversion Time (s)",
        BIDSType: "Numeric",
        editable: true,
        width: 150,
        min: 0.001,
        max: 5,
        step: 0.001,
        description: `The time, in seconds, after the middle of inverting the RF pulse to the middle of the ` +
            `excitation pulse used to detect the amount of longitudinal magnetization.`,
        renderEditCell: (params) => {
            return (React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 2, inputProps: { min: 0.001, max: 5, step: 0.001 } }));
        },
    },
    MagneticFieldStrength: {
        field: "MagneticFieldStrength",
        headerName: "Magnetic Field Strength (T)",
        BIDSType: "Numeric",
        editable: true,
        width: 230,
        min: 0,
        max: 14,
        step: 0.1,
        description: "Magnetic field strength, in teslas, of the MR scanner at the time of the scan.",
        renderEditCell: (params) => {
            return React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 3, inputProps: { min: 0, max: 14, step: 0.1 } });
        },
    },
    M0Estimate: {
        field: "M0Estimate",
        headerName: "M0 Estimate (a.u.)",
        BIDSType: "Numeric",
        editable: true,
        width: 150,
        min: 0,
        max: 1000000000,
        step: 0.1,
        description: `A single numerical whole-brain M0 value (referring to the M0 of blood). ` +
            `This field is REQUIRED if the "M0 Type" value for the same row is "Estimate". ` +
            `This field cannot be zero, as that would lead to a division error.`,
        renderEditCell: (params) => {
            return (React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 1, inputProps: { min: 0, max: 1000000000, step: 0.1 } }));
        },
    },
    M0_GMScaleFactor: {
        field: "M0_GMScaleFactor",
        headerName: "M0 Gray Matter Scale Factor (a.u.)",
        BIDSType: "Numeric",
        editable: true,
        width: 310,
        min: 0.001,
        max: 1000000000,
        step: 0.001,
        description: `A multiplicative scale factor used to adjust the M0 value within a subject's gray matter voxels. ` +
            `This field cannot be zero.`,
        renderEditCell: (params) => {
            return (React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 1, inputProps: { min: 0.001, max: 1000000000, step: 0.001 } }));
        },
    },
    RepetitionTimePreparation: {
        field: "RepetitionTimePreparation",
        headerName: "Repetition Time (s)",
        BIDSType: "Numeric",
        editable: true,
        width: 180,
        min: 0,
        max: 100,
        step: 0.001,
        description: `The time, in seconds, that it takes a preparation pulse block to re-appear at the beginning ` +
            `of the succeeding (essentially identical) pulse sequence block.`,
        renderEditCell: (params) => {
            return React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 4, inputProps: { min: 0, max: 100, step: 0.001 } });
        },
    },
    TotalAcquiredPairs: {
        field: "TotalAcquiredPairs",
        headerName: "Total Acquired Pairs",
        BIDSType: "Numeric",
        editable: true,
        width: 180,
        min: 1,
        max: 1000,
        step: 1,
        description: `The total number of control-label (or label-control) pairs acquired for each ASL timeseries.`,
        renderEditCell: (params) => {
            return React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 1, inputProps: { min: 1, max: 1000, step: 1 } });
        },
    },
    TotalReadoutTime: {
        field: "TotalReadoutTime",
        headerName: "Total Readout Time (s)",
        BIDSType: "Numeric",
        editable: true,
        width: 200,
        min: 0,
        max: 10,
        step: 0.001,
        description: `This is actually the "effective" total readout time, defined as the readout duration, ` +
            `specified in seconds, that would have generated data with the given level of distortion. ` +
            `It is NOT the actual, physical duration of the readout train.`,
        renderEditCell: (params) => {
            return React.createElement(BIDSSingleNumberField, { params: params, defaultValue: 0, inputProps: { min: 0, max: 10, step: 0.001 } });
        },
    },
};
//# sourceMappingURL=BIDSNumericColDefs.js.map