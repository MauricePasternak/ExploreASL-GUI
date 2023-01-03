import CloseIcon from "@mui/icons-material/Close";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { DebouncedInput } from "../../../components/DebouncedComponents";
import { atomDataVizDF, atomDataVizDFDTypes, atomSetRemovePredicate, } from "../../../stores/DataFrameVisualizationStore";
const NeutralFuncs = new Set(["eq", "ne"]);
const ContinuousFuncs = new Set(["gt", "lt", "ge", "le"]);
const CategoricalFuncs = new Set(["includes", "excludes"]);
const OperatorOptions = [
    { label: "Greater than or Equal To (≥)", value: "ge" },
    { label: "Less Than or Equal To (≤)", value: "le" },
    { label: "Greater Than (>)", value: "gt" },
    { label: "Less Than (<)", value: "lt" },
    { label: "Equal To (=)", value: "eq" },
    { label: "Not Equal To (≠)", value: "ne" },
    { label: "Includes", value: "includes" },
    { label: "Excludes", value: "excludes" },
];
function SingleSubsetter({ atomPredicateFormula, subsetterIndex }) {
    const [predicate, setPredicate] = useAtom(atomPredicateFormula);
    const dataFrameTypes = useAtomValue(atomDataVizDFDTypes);
    const dataFrame = useAtomValue(atomDataVizDF); // We use the original DF here, not the subsetted one
    const removePredicate = useSetAtom(atomSetRemovePredicate);
    const isColumnInDataFrame = Object.keys(dataFrameTypes).includes(predicate.col);
    const currentColType = isColumnInDataFrame ? dataFrameTypes[predicate.col] : false;
    const handleColNameChange = (event) => {
        const colName = event.target.value;
        const colType = dataFrameTypes[colName];
        const shouldUpdatePredicate = (colType === "Categorical" && ContinuousFuncs.has(predicate.funcName)) ||
            (colType === "Continuous" && CategoricalFuncs.has(predicate.funcName));
        const newPredicate = {
            funcName: shouldUpdatePredicate ? "eq" : predicate.funcName,
            val: "",
            col: colName,
        };
        setPredicate(newPredicate);
    };
    const handleOperatorChange = (event) => {
        const newOperator = event.target.value;
        const currentColName = predicate.col;
        const currentColType = dataFrameTypes[currentColName];
        // If the operator is "includes" or "excludes", we need to make sure that the column is a Categorical type
        if ((newOperator === "includes" || newOperator === "excludes") && currentColType !== "Categorical")
            return;
        // If the operator is numeric, we need to make sure that the column is a Continuous type
        if (["gt", "ge", "lt", "le"].includes(newOperator) && currentColType !== "Continuous")
            return;
        const newPredicate = Object.assign(Object.assign({}, predicate), { val: "", funcName: newOperator });
        setPredicate(newPredicate);
    };
    const handleValueChange = (v) => {
        // Early exit if the column and its dtype hasn't been established yet
        if (!isColumnInDataFrame || !currentColType)
            return;
        let newValue = v;
        // Convert to a number if the column is numeric
        if (currentColType === "Continuous") {
            try {
                newValue = new Number(newValue);
            }
            catch (error) {
                console.warn(`Could not convert ${newValue} to a number. Error: ${error}`);
                return;
            }
        }
        const newPredicate = Object.assign(Object.assign({}, predicate), { val: newValue });
        console.log(`Subsetter ${subsetterIndex}: Setting predicate to ${JSON.stringify(newPredicate)}`);
        setPredicate(newPredicate);
    };
    const renderValueField = () => {
        if (!isColumnInDataFrame || !currentColType)
            return null;
        if (predicate.funcName === "includes" ||
            predicate.funcName === "excludes" ||
            (currentColType === "Categorical" && ["eq", "ne"].includes(predicate.funcName))) {
            const isMultiple = predicate.funcName === "includes" || predicate.funcName === "excludes";
            const value = isMultiple
                ? Array.isArray(predicate.val)
                    ? predicate.val
                    : [predicate.val].filter((v) => v !== "")
                : predicate.val;
            return (React.createElement(FormControl, { fullWidth: true },
                React.createElement(InputLabel, null, "Value"),
                React.createElement(Select, { multiple: isMultiple, label: "value", value: value, onChange: handleValueChange }, dataFrame
                    .getSeries(predicate.col)
                    .distinct()
                    .toArray()
                    .map((value) => {
                    return (React.createElement(MenuItem, { key: `ValueOption_${value}`, value: value }, value));
                }))));
        }
        return (React.createElement(DebouncedInput, { fullWidth: true, type: currentColType === "Continuous" ? "number" : "text", value: predicate.val, onChange: handleValueChange }));
    };
    return (React.createElement(Card, null,
        React.createElement(CardHeader, { title: `Subsetter ${subsetterIndex + 1}`, action: React.createElement(IconButton, { onClick: () => removePredicate(subsetterIndex) },
                React.createElement(CloseIcon, null)) }),
        React.createElement(CardContent, null,
            React.createElement(Stack, { spacing: 2 },
                React.createElement(FormControl, { fullWidth: true },
                    React.createElement(InputLabel, null, "Column Name"),
                    React.createElement(Select, { label: "Column Name", value: predicate.col, onChange: handleColNameChange }, Object.entries(dataFrameTypes).map(([colName, colType], colNameOptionIndex) => {
                        if (colType === "Ignore")
                            return null;
                        return (React.createElement(MenuItem, { key: `SubsetterColumnNameOption_${colNameOptionIndex}__Subsetter_${subsetterIndex}`, value: colName }, colName));
                    }))),
                React.createElement(FormControl, { fullWidth: true },
                    React.createElement(InputLabel, null, "Operator"),
                    React.createElement(Select, { label: "Operator", value: predicate.funcName, onChange: handleOperatorChange }, OperatorOptions.map((operator, operatorOptionIndex) => {
                        return (React.createElement(MenuItem, { key: `SubsetterOption_${operatorOptionIndex}__Subsetter_${subsetterIndex}`, value: operator.value, disabled: (isColumnInDataFrame &&
                                currentColType === "Categorical" &&
                                ContinuousFuncs.has(operator.value)) ||
                                (isColumnInDataFrame && currentColType === "Continuous" && CategoricalFuncs.has(operator.value)) }, operator.label));
                    }))),
                renderValueField()))));
}
export default SingleSubsetter;
//# sourceMappingURL=SingleSubsetter.js.map