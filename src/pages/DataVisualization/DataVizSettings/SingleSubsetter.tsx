import CloseIcon from "@mui/icons-material/Close";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { predicateFormula } from "../../../common/types/dataFrameTypes";
import { DebouncedInput } from "../../../components/DebouncedComponents";
import {
  atomDataVizDF,
  atomDataVizDFDTypes,
  atomSetRemovePredicate,
} from "../../../stores/DataFrameVisualizationStore";

interface SingleSubsetterProps {
  subsetterIndex: number;
  atomPredicateFormula: PrimitiveAtom<predicateFormula>;
}

const NeutralFuncs = new Set(["eq", "ne"]);
const ContinuousFuncs = new Set(["gt", "lt", "ge", "le"]);
const CategoricalFuncs = new Set(["includes", "excludes"]);

const OperatorOptions: { label: string; value: predicateFormula["funcName"] }[] = [
  { label: "Greater than or Equal To (≥)", value: "ge" },
  { label: "Less Than or Equal To (≤)", value: "le" },
  { label: "Greater Than (>)", value: "gt" },
  { label: "Less Than (<)", value: "lt" },
  { label: "Equal To (=)", value: "eq" },
  { label: "Not Equal To (≠)", value: "ne" },
  { label: "Includes", value: "includes" },
  { label: "Excludes", value: "excludes" },
];

function SingleSubsetter({ atomPredicateFormula, subsetterIndex }: SingleSubsetterProps) {
  const [predicate, setPredicate] = useAtom(atomPredicateFormula);
  const dataFrameTypes = useAtomValue(atomDataVizDFDTypes);
  const dataFrame = useAtomValue(atomDataVizDF); // We use the original DF here, not the subsetted one
  const removePredicate = useSetAtom(atomSetRemovePredicate);

  const isColumnInDataFrame = Object.keys(dataFrameTypes).includes(predicate.col);
  const currentColType = isColumnInDataFrame ? dataFrameTypes[predicate.col] : false;

  const handleColNameChange = (event: SelectChangeEvent<string>) => {
    const colName = event.target.value;
    const colType = dataFrameTypes[colName];
    const shouldUpdatePredicate =
      (colType === "Categorical" && ContinuousFuncs.has(predicate.funcName)) ||
      (colType === "Continuous" && CategoricalFuncs.has(predicate.funcName));

    const newPredicate = {
      funcName: shouldUpdatePredicate ? "eq" : predicate.funcName, // Reset to "eq" if the new col is not of the same type as the current func
      val: "", // Reset the value to blank every time
      col: colName,
    };

    setPredicate(newPredicate as predicateFormula);
  };

  const handleOperatorChange = (event: SelectChangeEvent<string>) => {
    const newOperator = event.target.value as predicateFormula["funcName"];
    const currentColName = predicate.col;
    const currentColType = dataFrameTypes[currentColName];

    // If the operator is "includes" or "excludes", we need to make sure that the column is a Categorical type
    if ((newOperator === "includes" || newOperator === "excludes") && currentColType !== "Categorical") return;

    // If the operator is numeric, we need to make sure that the column is a Continuous type
    if (["gt", "ge", "lt", "le"].includes(newOperator) && currentColType !== "Continuous") return;

    const newPredicate = {
      ...predicate,
      val: "", // value is reset to blank every time the operator changes
      funcName: newOperator,
    };
    setPredicate(newPredicate as predicateFormula);
  };

  const handleValueChange = (v: unknown) => {
    // Early exit if the column and its dtype hasn't been established yet
    if (!isColumnInDataFrame || !currentColType) return;
    let newValue: number | string = v as string;
    // Convert to a number if the column is numeric
    if (currentColType === "Continuous") {
      try {
        newValue = new Number(newValue) as number | string;
      } catch (error) {
        console.warn(`Could not convert ${newValue} to a number. Error: ${error}`);
        return;
      }
    }
    const newPredicate = { ...predicate, val: newValue };
    console.log(`Subsetter ${subsetterIndex}: Setting predicate to ${JSON.stringify(newPredicate)}`);

    setPredicate(newPredicate as predicateFormula);
  };

  const renderValueField = () => {
    if (!isColumnInDataFrame || !currentColType) return null;

    if (
      predicate.funcName === "includes" ||
      predicate.funcName === "excludes" ||
      (currentColType === "Categorical" && ["eq", "ne"].includes(predicate.funcName))
    ) {
      const isMultiple = predicate.funcName === "includes" || predicate.funcName === "excludes";
      const value = isMultiple
        ? Array.isArray(predicate.val)
          ? predicate.val
          : [predicate.val].filter((v) => v !== "")
        : predicate.val;

      return (
        <FormControl fullWidth>
          <InputLabel>Value</InputLabel>
          <Select multiple={isMultiple} label="value" value={value} onChange={handleValueChange}>
            {dataFrame
              .getSeries(predicate.col)
              .distinct()
              .toArray()
              .map((value) => {
                return (
                  <MenuItem key={`ValueOption_${value}`} value={value}>
                    {value}
                  </MenuItem>
                );
              })}
          </Select>
        </FormControl>
      );
    }

    return (
      <DebouncedInput
        fullWidth
        type={currentColType === "Continuous" ? "number" : "text"}
        value={predicate.val}
        onChange={handleValueChange}
      />
    );
  };

  return (
    <Card>
      <CardHeader
        title={`Subsetter ${subsetterIndex + 1}`}
        action={
          <IconButton onClick={() => removePredicate(subsetterIndex)}>
            <CloseIcon />
          </IconButton>
        }
      />
      <CardContent>
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel>Column Name</InputLabel>
            <Select label="Column Name" value={predicate.col} onChange={handleColNameChange}>
              {Object.entries(dataFrameTypes).map(([colName, colType], colNameOptionIndex) => {
                if (colType === "Ignore") return null;
                return (
                  <MenuItem
                    key={`SubsetterColumnNameOption_${colNameOptionIndex}__Subsetter_${subsetterIndex}`}
                    value={colName}
                  >
                    {colName}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Operator</InputLabel>
            <Select label="Operator" value={predicate.funcName} onChange={handleOperatorChange}>
              {OperatorOptions.map((operator, operatorOptionIndex) => {
                return (
                  <MenuItem
                    key={`SubsetterOption_${operatorOptionIndex}__Subsetter_${subsetterIndex}`}
                    value={operator.value}
                    disabled={
                      (isColumnInDataFrame &&
                        currentColType === "Categorical" &&
                        ContinuousFuncs.has(operator.value)) ||
                      (isColumnInDataFrame && currentColType === "Continuous" && CategoricalFuncs.has(operator.value))
                    }
                  >
                    {operator.label}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>

          {renderValueField()}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default SingleSubsetter;
