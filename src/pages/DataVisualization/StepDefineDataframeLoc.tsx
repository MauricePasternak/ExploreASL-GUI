import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircleIcon from "@mui/icons-material/Circle";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { DataFrame, fromCSV, IDataFrame, ISeries } from "data-forge";
import { useSetAtom, atom } from "jotai";
import React from "react";
import { SubmitErrorHandler, SubmitHandler, useForm } from "react-hook-form";
import { DataVizLoadDFSchema } from "../../common/schemas/DataVizLoadDFSchema";
import { DataFrameMainType } from "../../common/types/dataFrameTypes";
import { LoadEASLDataFrameSchema } from "../../common/types/DataVizSchemaTypes";
import {
  getColumnDtypeFreq,
  innerJoin,
  isNumericSeries,
  outerLeftJoin,
} from "../../common/utilityFunctions/dataFrameFunctions";
import { YupResolverFactoryBase } from "../../common/utilityFunctions/formFunctions";
import RHFFilepathTextField from "../../components/FormComponents/RHFFilepathTextfield";
import RHFSelect, { RHFControlledSelectOption } from "../../components/FormComponents/RHFSelect";
import OutlinedGroupBox from "../../components/OutlinedGroupBox";
import {
  atomCurrentMRIViewSubject,
  atomDataVizCurrentStep,
  atomDataVizDF,
  atomDataVizDFDTypes,
  atomOfAtomMRIData,
  atomOfAtomsDataVizSubsetOperations,
  loadDataFrameDataVizDefaults,
} from "../../stores/DataFrameVisualizationStore";
import { atomDataVizModuleSnackbar } from "../../stores/SnackbarStore";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Avatar from "@mui/material/Avatar";
import CardContent from "@mui/material/CardContent";
import FolderIcon from "@mui/icons-material/Folder";
import Divider from "@mui/material/Divider";

const atlasesOptions: RHFControlledSelectOption<LoadEASLDataFrameSchema, "Atlases">[] = [
  { label: "WholeBrain Grey Matter", value: "TotalGM" },
  { label: "Wholebrain White Matter", value: "DeepWM" },
  { label: "MNI Cortical Atlas", value: "MNI_Structural" },
  { label: "Hammers Atlas", value: "Hammers" },
  { label: "Harvard-Oxford Cortical", value: "HOcort_CONN" },
  { label: "Harvard-Oxford Subcortical", value: "HOsub_CONN" },
  { label: "OASIS Atlas", value: "Mindboggle_OASIS_DKT31_CMA" },
];

function renderLoadDFError(statistic: string, atlases: string[], pvc: boolean) {
  return (
    <div>
      <Typography>
        Could not load data for statistic: {statistic}, atlas: {atlases.join(", ")}, and PVC {pvc}...
      </Typography>
      <Typography>One of the following may be the cause:</Typography>
      <List>
        <ListItem>
          <ListItemIcon>
            <CircleIcon />
          </ListItemIcon>
          <ListItemText>You haven't run the Population module yet for this study.</ListItemText>
        </ListItem>
        <ListItem>
          <ListItemIcon>
            <CircleIcon />
          </ListItemIcon>
          <ListItemText>
            You have run the Population module once, but you forgot to specify which atlases should be analyzed when you
            were defining parameters. If this is the case, you will have to go back to Define Parameters to adjust that
            field and re-run the Population Module for your study.
          </ListItemText>
        </ListItem>
        <ListItem>
          <ListItemIcon>
            <CircleIcon />
          </ListItemIcon>
          <ListItemText>
            Some unforseen filesystem error happened and the data files were lost. Try re-running the Population module
            for your study?
          </ListItemText>
        </ListItem>
      </List>
    </div>
  );
}

function handleCleanRawDF(df: DataFrame | IDataFrame) {
  const dtypeMapping = {} as Record<string, DataFrameMainType>;
  const colsToDrop = [] as string[];
  const convertedSeries = {} as Record<string, ISeries>;

  for (const colName of df.getColumnNames()) {
    const series = df.getSeries(colName);
    const dtype = getColumnDtypeFreq(series);

    // Pure type
    if (typeof dtype === "string") {
      // Pure string
      if (dtype === "string") {
        dtypeMapping[colName] = "Categorical";
      } else if (dtype === "number") {
        dtypeMapping[colName] = "Continuous";
      } else if (dtype === "boolean") {
        dtypeMapping[colName] = "Categorical";
        convertedSeries[colName] = series.map(x => (x == null ? null : x === true ? "True" : "False"));
      } else if (dtype === "date") {
        dtypeMapping[colName] = "Categorical";
        convertedSeries[colName] = series.map((x: Date) => (x == null ? null : x.toString()));
      } else {
        colsToDrop.push(colName);
      }
    }
    // Impure type
    else {
      // Complex types automatically removed
      if (dtype.object || dtype.array) {
        colsToDrop.push(colName);
      } else {
        const numericType = isNumericSeries(series);
        if (numericType) {
          dtypeMapping[colName] = "Continuous";
          convertedSeries[colName] = numericType === "Float" ? series.parseFloats() : series.parseInts();
        } else {
          dtypeMapping[colName] = "Categorical";
          convertedSeries[colName] = series.map((x: string) => (x == null ? null : x.toString()));
        }
      }
    }
  } // End for loop

  // Drop columns, convert series, and return the expected tuple
  const cleanDF = new DataFrame(df.dropSeries(colsToDrop).withSeries(convertedSeries).toArray());
  return [dtypeMapping, cleanDF] as const;
}

function StepDefineDataframeLoc() {
  const { api } = window;
  const setDataVizCurrentStep = useSetAtom(atomDataVizCurrentStep);
  const setDataVizDF = useSetAtom(atomDataVizDF);
  const setDataVizDFDTypes = useSetAtom(atomDataVizDFDTypes);
  const setDataVizSubsetOps = useSetAtom(atomOfAtomsDataVizSubsetOperations);
  const setDataVizSnackbar = useSetAtom(atomDataVizModuleSnackbar);
  const setCurrentMRIViewSubject = useSetAtom(atomCurrentMRIViewSubject);
  const setAtomsMRIData = useSetAtom(atomOfAtomMRIData);

  const { control, handleSubmit } = useForm({
    defaultValues: loadDataFrameDataVizDefaults,
    resolver: YupResolverFactoryBase(DataVizLoadDFSchema),
  });

  const handleValidSubmit: SubmitHandler<LoadEASLDataFrameSchema> = async values => {
    console.log("Step 'Define Runtime Envs' -- Valid Submit Values: ", values);
    const statisticsPath = api.path.asPath(values.StudyRootPath, "derivatives", "ExploreASL", "Population", "Stats");

    /**
     * Part 1: Load the ExploreASL dataframes, merging them into a single dataframe if necessary
     */
    const atlasBasenames = values.Atlases.map(atlasName => {
      return `${values.Statistic}_qCBF_StandardSpace_${atlasName}_*${values.PVC}.tsv`;
    });
    const pathsEASLDF = await api.path.glob(statisticsPath.path, atlasBasenames);

    let tmpIDF: IDataFrame = null;
    let EASLDF: DataFrame = null;
    for (const pathDF of pathsEASLDF) {
      const fetchDF = await api.invoke("Dataframe:Load", pathDF.path);
      if (!fetchDF.success) {
        setDataVizSnackbar({
          severity: "error",
          title: "Could not load one or more ExploreASL dataframes",
          message: [
            "Encountered the following error while loading dataframe:",
            `${pathDF.path}`,
            ...fetchDF.errorMessages,
          ],
        });
        return;
      }

      // First round, just re-assign
      if (tmpIDF == null) {
        tmpIDF = fromCSV(fetchDF.data, { dynamicTyping: true }).after(0); // after(0) to skip ExploreASL's 1st row
        continue;
      }

      // Otherwise, merge
      tmpIDF = innerJoin(tmpIDF, fromCSV(fetchDF.data, { dynamicTyping: true }).after(0), "SUBJECT");
    } // End of for loop
    EASLDF = new DataFrame(tmpIDF.toArray());

    console.log("Step 'Define Runtime Envs' -- EASLDF: ", EASLDF.toArray());

    /**
     * Part 2: Load the Metadata dataframe
     */
    let MetadataDF: DataFrame = null;
    if (values.MetadataPath) {
      const fetchMetaDF = await api.invoke("Dataframe:Load", values.MetadataPath);
      if (!fetchMetaDF.success) {
        setDataVizSnackbar({
          severity: "error",
          title: "Could not load the Metadata dataframe",
          message: [
            "Encountered the following error while loading dataframe:",
            `${values.MetadataPath}`,
            ...fetchMetaDF.errorMessages,
          ],
        });
        return;
      }
      MetadataDF = fromCSV(fetchMetaDF.data, { dynamicTyping: true });
    } // End of if statement

    console.log("Step 'Define Runtime Envs' -- MetadataDF: ", MetadataDF.toArray());

    /**
     * Part 3: Merge the ExploreASL and Metadata dataframes
     */
    let mergedDF: DataFrame = null;
    if (MetadataDF) {
      // Sanity Check for merge column
      // TODO: It may be worthwhile to any filter out invalid subjects that aren't present in rawdata...
      if (!MetadataDF.getColumnNames().includes("SUBJECT")) {
        setDataVizSnackbar({
          severity: "error",
          title: "Could not find the SUBJECT column in the Metadata dataframe",
          message: [
            "Encountered the following error while loading dataframe:",
            `${values.MetadataPath}`,
            "The SUBJECT column is required for merging the ExploreASL and Metadata dataframes",
          ],
        });
        return;
      }
      mergedDF = new DataFrame(outerLeftJoin(EASLDF, MetadataDF, "SUBJECT").toArray());
    } else {
      mergedDF = EASLDF;
    }

    console.log("Step 'Define Runtime Envs' -- Merged Dataframe: ", mergedDF.toArray());

    /**
     * Part 4: Clean the dataframe and set the fields
     */
    const [dtypeMapping, cleanDF] = handleCleanRawDF(mergedDF);
    setDataVizDF(cleanDF); // Set the new dataframe
    setDataVizDFDTypes(dtypeMapping); // Set the new dataframe dtypes
    setDataVizSubsetOps([]); // Reset subset operations
    setCurrentMRIViewSubject(""); // Reset current subject
    setAtomsMRIData([atom([]), atom([]), atom([])]); // Reset MRIData
    setDataVizCurrentStep("DefineDTypes"); // Proceed to next step
  };

  const handleInvalidSubmit: SubmitErrorHandler<LoadEASLDataFrameSchema> = errors => {
    console.log("Step 'Define Runtime Envs' -- Invalid Submit Errors: ", errors);
  };

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <Box padding={2}>
        <Card>
          <CardHeader
            title={<Typography variant="h4">Load DataFrame</Typography>}
            subheader={
              <Typography>
                Define which spreadsheets should be loaded, including your own metadata spreadsheet
              </Typography>
            }
            avatar={
              <Avatar sizes="large">
                <FolderIcon />
              </Avatar>
            }
          />
          <Divider />
          <CardContent>
            <OutlinedGroupBox
              label="Load DataFrame Parameters"
              mt={3}
              labelBackgroundColor={theme => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
            >
              <Grid container rowSpacing={3} columnSpacing={3} marginTop={0} padding={1}>
                <Grid item xs={12} md={6} xl={3}>
                  <RHFFilepathTextField
                    control={control}
                    name="StudyRootPath"
                    filepathType="dir"
                    dialogOptions={{ properties: ["openDirectory"] }}
                    label="Study Root Path"
                    helperText="This is the root of your dataset"
                  />
                </Grid>
                <Grid item xs={12} md={6} xl={3}>
                  <RHFFilepathTextField
                    control={control}
                    name="MetadataPath"
                    filepathType="file"
                    dialogOptions={{
                      properties: ["openFile"],
                      filters: [{ name: "CSV, TSV", extensions: ["csv", "tsv"] }],
                    }}
                    label="Metadata Filepath"
                    helperText={`(Optional) Filepath to any metadata for your dataset. Must be a ".csv" or ".tsv" file.`}
                  />
                </Grid>
                <Grid item xs={12} md={6} xl={3}>
                  <RHFSelect
                    control={control}
                    name="Statistic"
                    label="Which Atlas Statistic to Load"
                    options={[
                      { label: "Mean", value: "mean" },
                      { label: "Median", value: "median" },
                      { label: "Coefficient of Variation", value: "CoV" },
                    ]}
                  />
                </Grid>
                <Grid item xs={12} md={6} xl={3}>
                  <RHFSelect
                    control={control}
                    name="PVC"
                    label="Which Partial Volume Correction Spreadsheet to Load"
                    options={[
                      { label: "With Partial Volume Correction", value: "PVC2" },
                      { label: "No Partial Volume Correction", value: "PVC0" },
                    ]}
                  />
                </Grid>
                <Grid item xs={12}>
                  <RHFSelect
                    control={control}
                    name="Atlases"
                    label="Atlases to Load"
                    options={atlasesOptions}
                    multiple
                    helperText="The atlases that should be loaded"
                  />
                </Grid>
              </Grid>
            </OutlinedGroupBox>
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
          justifyContent: "flex-end",
        }}
      >
        <Button type="submit">Proceed To Clarify Data Types</Button>
      </Paper>
    </form>
  );
}

export default React.memo(StepDefineDataframeLoc);
