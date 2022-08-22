import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { DataFrameMainType } from "../../common/types/dataFrameTypes";
import FabDialogWrapper from "../../components/WrapperComponents/FabDialogWrapper";
import {
  atomDataVizCurrentStep,
  atomDataVizDFDTypes,
  atomSetDataVizDF,
  DataFrameMainTypeOptions
} from "../../stores/DataFrameVisualizationStore";
import HelpDataViz__StepClarifyDataTypes from "../Help/HelpDataViz__StepClarifyDataTypes";

function StepClarifyDataTypes() {
  const dataFrameTypes = useAtomValue(atomDataVizDFDTypes);
  const setDataFrame = useSetAtom(atomSetDataVizDF);
  const setDataVizCurrentStep = useSetAtom(atomDataVizCurrentStep);

  function handleDTypeChange(event: SelectChangeEvent<DataFrameMainType>, colName: string) {
    const newDType = event.target.value as DataFrameMainType;
    console.log(`Changing ${colName} to ${newDType} type`);
    setDataFrame({ col: colName, mainDtype: newDType });
  }

  console.log("StepClarifyDataTypes -- dataFrameTypes: ", dataFrameTypes);

  // TODO: There should be logic wherein a Regex is used to automatically avoid the default ExploreASL numerical column
  // names and some of the categorical ones such as SUBJECT and session.

  return (
    dataFrameTypes && (
      <>
        <Box p={2}>
          <Card elevation={2}>
            <CardHeader
              title={<Typography variant="h4">Specify Datatypes</Typography>}
              subheader={
                <Typography>
                  Inform the program about whether columns are to be interpreted as Continuous or Categorical or
                  outright Ignored
                </Typography>
              }
              avatar={
                <Avatar sizes="large">
                  <PersonSearchIcon />
                </Avatar>
              }
              action={
                <FabDialogWrapper maxWidth="xl" PaperProps={{ sx: { minWidth: "499px" } }} sx={{ marginTop: "40px" }}>
                  <HelpDataViz__StepClarifyDataTypes />
                </FabDialogWrapper>
              }
            />
            <Divider />
            <CardContent>
              <List>
                <ListItem>
                  <Box width="100%" display="flex" justifyContent="space-between">
                    <Typography variant="h5">Column Name</Typography>
                    <Typography variant="h5">Data Type</Typography>
                  </Box>
                </ListItem>
                {Object.entries(dataFrameTypes).map(([columnName, dtype], colIdx) => {
                  if (typeof dtype !== "string") return null;
                  return (
                    <ListItem key={`DataFrameDtypeClarifier__${columnName}_${colIdx}`}>
                      <Box width="100%" display="flex" alignItems="center">
                        <Typography noWrap variant="h5" flexBasis="400px" mr={10}>
                          {columnName}
                        </Typography>
                        <Select fullWidth value={dtype} onChange={e => handleDTypeChange(e, columnName)}>
                          {DataFrameMainTypeOptions.map((dtype, idx) => {
                            return (
                              <MenuItem key={`DataFrameDtypeClarifier__${columnName}_${idx}`} value={dtype}>
                                {dtype}
                              </MenuItem>
                            );
                          })}
                        </Select>
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
            </CardContent>
          </Card>
        </Box>
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
          }}
        >
          <Button onClick={() => setDataVizCurrentStep("DefinePaths")}>Back to Loading Spreadsheets</Button>
          <Button onClick={() => setDataVizCurrentStep("Plotting")}>Go to Plotting</Button>
        </Paper>
      </>
    )
  );
}

export default React.memo(StepClarifyDataTypes);
