import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Avatar from "@mui/material/Avatar";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import ExpandMore from "../../../components/ExpandMore";
import FunctionVariableIcon from "../../../assets/svg/FunctionVariable.svg";
import { DataFrameMainType } from "../../../common/types/dataFrameTypes";
import { NivoGraphType } from "../../../common/types/DataVizSchemaTypes";
import {
  atomDataVizDFDTypes,
  atomNivoGraphDataVariablesSchema,
  atomNivoGraphType,
} from "../../../stores/DataFrameVisualizationStore";

function PlotTypeSettings() {
  const [expanded, setExpanded] = React.useState(true);
  const dtypes = useAtomValue(atomDataVizDFDTypes);
  const [nivoGraphType, setNivoGraphType] = useAtom(atomNivoGraphType);
  const [nivoGraphDataSchema, setNivoGraphDataSchema] = useAtom(atomNivoGraphDataVariablesSchema);

  function renderOptions(
    permittedType: DataFrameMainType | "Any",
    prefix = "PlotTypeOption",
    disabledCondition = [] as string[]
  ) {
    console.log(`renderOptions for prefix ${prefix} -- permittedType: `, permittedType);

    return Object.entries(dtypes)
      .map(([colName, dtype], colIdx) => {
        if (colName === "SUBJECT" || (dtype !== permittedType && permittedType !== "Any")) return null;
        return (
          <MenuItem
            key={`${prefix}__${colIdx}`}
            value={colName}
            disabled={
              disabledCondition.includes(colName) ||
              colName === nivoGraphDataSchema.XAxisVar ||
              colName === nivoGraphDataSchema.YAxisVar
            }
          >
            {colName}
          </MenuItem>
        );
      })
      .filter(x => x !== null);
  }

  return (
    <Card elevation={1} sx={{ margin: 0.5 }}>
      <CardHeader
        title={<Typography variant="h5">Plot Variables</Typography>}
        subheader={
          <Typography variant="subtitle1">Define which columns should be plotted and the graph type</Typography>
        }
        avatar={
          <Avatar>
            <SvgIcon component={FunctionVariableIcon} inheritViewBox />
          </Avatar>
        }
        action={
          <ExpandMore
            expand={expanded}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label="show more"
          >
            <ExpandMoreIcon />
          </ExpandMore>
        }
      />

      <Collapse in={expanded}>
        <CardContent>
          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Graph Type</InputLabel>
              <Select
                fullWidth
                label="Graph Type"
                value={nivoGraphType}
                onChange={e => {
                  setNivoGraphType(e.target.value as NivoGraphType);
                  setNivoGraphDataSchema({ ...nivoGraphDataSchema, XAxisVar: "", YAxisVar: "", GroupingVar: "" });
                }}
              >
                {(["Scatterplot", "Swarmplot"] as NivoGraphType[]).map((gType, gTypeIdx) => {
                  return (
                    <MenuItem key={`GraphTypeMenuItem__${gTypeIdx}`} value={gType}>
                      {gType}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>X Axis</InputLabel>
              <Select
                fullWidth
                label="X Axis"
                value={nivoGraphDataSchema.XAxisVar}
                onChange={e => {
                  setNivoGraphDataSchema({
                    ...nivoGraphDataSchema,
                    HoverVariables: nivoGraphDataSchema.HoverVariables
                      ? nivoGraphDataSchema.HoverVariables.filter(l => l !== e.target.value)
                      : [],
                    XAxisVar: e.target.value as string,
                  });
                }}
              >
                {renderOptions(nivoGraphType === "Swarmplot" ? "Categorical" : "Continuous", "XAxisVar")}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Y Axis</InputLabel>
              <Select
                fullWidth
                label="Y Axis"
                value={nivoGraphDataSchema.YAxisVar}
                onChange={e => {
                  setNivoGraphDataSchema({
                    ...nivoGraphDataSchema,
                    HoverVariables: nivoGraphDataSchema.HoverVariables
                      ? nivoGraphDataSchema.HoverVariables.filter(l => l !== e.target.value)
                      : [],
                    YAxisVar: e.target.value as string,
                  });
                }}
              >
                {renderOptions("Continuous", "YAxisVar")}
              </Select>
            </FormControl>

            {nivoGraphType === "Scatterplot" && (
              <FormControl fullWidth>
                <InputLabel>Color</InputLabel>
                <Select
                  fullWidth
                  label="Color"
                  value={nivoGraphDataSchema.GroupingVar}
                  onChange={e => {
                    setNivoGraphDataSchema({ ...nivoGraphDataSchema, GroupingVar: e.target.value as string });
                  }}
                >
                  {renderOptions("Categorical", "GroupingVar", [nivoGraphDataSchema.XAxisVar])}
                </Select>
              </FormControl>
            )}

            <FormControl fullWidth>
              <InputLabel>Additional Hover Data</InputLabel>
              <Select
                fullWidth
                multiple
                label="Additional Hover Data"
                value={nivoGraphDataSchema.HoverVariables}
                onChange={e =>
                  setNivoGraphDataSchema({ ...nivoGraphDataSchema, HoverVariables: e.target.value as string[] })
                }
              >
                {renderOptions("Any", "HoverVariables")}
              </Select>
            </FormControl>
          </Stack>
        </CardContent>
      </Collapse>
    </Card>
  );
}

export default React.memo(PlotTypeSettings);
