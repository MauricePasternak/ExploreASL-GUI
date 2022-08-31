import CircleIcon from "@mui/icons-material/Circle";
import FolderIcon from "@mui/icons-material/Folder";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { DataFrame, fromCSV, IDataFrame, ISeries } from "data-forge";
import { atom, useAtom, useSetAtom } from "jotai";
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
import FabDialogWrapper from "../../components/WrapperComponents/FabDialogWrapper";
import {
  atomCurrentMRIViewSubject,
  atomDataVizCurrentStep,
  atomDataVizDF,
  atomDataVizDFDTypes,
  atomDataVizLoadSettings,
  atomNivoGraphDataVariablesSchema,
  atomOfAtomMRIData,
  atomOfAtomsDataVizSubsetOperations,
  defaultNivoGraphDataVariablesSchema,
} from "../../stores/DataFrameVisualizationStore";
import { atomDataVizModuleSnackbar } from "../../stores/SnackbarStore";
import HelpDataViz__StepDefineDataframeLoc from "../Help/HelpDataViz__StepDefineDataframeLoc";

const atlasesOptions: RHFControlledSelectOption<LoadEASLDataFrameSchema, "Atlases">[] = [
  { label: "WholeBrain Grey Matter", value: "TotalGM" },
  { label: "Wholebrain White Matter", value: "DeepWM" },
  { label: "MNI Cortical Atlas", value: "MNI_Structural" },
  { label: "Hammers Atlas", value: "Hammers" },
  { label: "Harvard-Oxford Cortical", value: "HOcort_CONN" },
  { label: "Harvard-Oxford Subcortical", value: "HOsub_CONN" },
  { label: "OASIS Atlas", value: "Mindboggle_OASIS_DKT31_CMA" },
];

const EASLColnamesNotPermittedInMetadata: string[] = [
  "LongitudinalTimePoint",
  "SubjectNList",
  "GM_vol",
  "WM_vol",
  "CSF_vol",
  "GM_ICVRatio",
  "GMWM_ICVRatio",
];

// Automatically coerce certain columns to a given type
const EASLCoerceToCategorical: Record<string, DataFrameMainType> = {
  LongitudinalTimePoint: "Categorical",
  SubjectNList: "Categorical",
};

function handleCleanRawDF(df: DataFrame | IDataFrame) {
  const dtypeMapping = {} as Record<string, DataFrameMainType>;
  const colsToDrop = [] as string[];
  const convertedSeries = {} as Record<string, ISeries>;

  for (const colName of df.getColumnNames()) {
    const series = df.getSeries(colName);
    const dtype = getColumnDtypeFreq(series);

    if (colName in EASLCoerceToCategorical) {
      dtypeMapping[colName] = EASLCoerceToCategorical[colName];
      convertedSeries[colName] = series.map((x: number) => (x == null ? null : x.toString()));
    }
    // Pure type
    else if (typeof dtype === "string") {
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
  const [dataVizLoadSettings, setDataVizLoadSettings] = useAtom(atomDataVizLoadSettings);
  const setDataVizDF = useSetAtom(atomDataVizDF);
  const setDataVizDFDTypes = useSetAtom(atomDataVizDFDTypes);
  const setDataVizSubsetOps = useSetAtom(atomOfAtomsDataVizSubsetOperations);
  const setDataVizSnackbar = useSetAtom(atomDataVizModuleSnackbar);
  const setGraphDataVariables = useSetAtom(atomNivoGraphDataVariablesSchema);
  const setCurrentMRIViewSubject = useSetAtom(atomCurrentMRIViewSubject);
  const setAtomsMRIData = useSetAtom(atomOfAtomMRIData);

  const { control, handleSubmit } = useForm({
    // defaultValues: loadDataFrameDataVizDefaults,
    defaultValues: dataVizLoadSettings,
    resolver: YupResolverFactoryBase(DataVizLoadDFSchema),
  });

  const handleValidSubmit: SubmitHandler<LoadEASLDataFrameSchema> = async values => {
    console.log("Step 'Define Runtime Envs' -- Valid Submit Values: ", values);
    const statisticsPath = api.path.asPath(values.StudyRootPath, "derivatives", "ExploreASL", "Population", "Stats");
    let mergeColumn: "SUBJECT" | "participant_id"; // Differs between EASL versions

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

      // First round, just re-assign. Also, this determines the merge column
      if (tmpIDF == null) {
        tmpIDF = fromCSV(fetchDF.data, { dynamicTyping: true }).after(0); // after(0) to skip ExploreASL's 1st row
        if (!tmpIDF.hasSeries("participant_id") && !tmpIDF.hasSeries("SUBJECT")) {
          setDataVizSnackbar({
            severity: "error",
            title: "Merge column not found",
            message: [
              "Encountered the following error while loading dataframe:",
              `${pathDF.path}`,
              `The dataframe does not contain the expected column named 'participant_id' (ExploreASL v1.10 onwards) or 'SUBJECT' (ExploreASL v1.9 and earlier)`,
            ],
          });
          return;
        }
        mergeColumn = tmpIDF.hasSeries("participant_id") ? "participant_id" : "SUBJECT";
        continue;
      }

      // Otherwise, merge
      const nextDF = fromCSV(fetchDF.data, { dynamicTyping: true }).after(0);
      if (!nextDF.hasSeries(mergeColumn)) {
        setDataVizSnackbar({
          severity: "error",
          title: "Merge column not found",
          message: [
            "Encountered the following error while loading dataframe:",
            `${pathDF.path}`,
            `The dataframe does not contain the expected column named '${mergeColumn}'`,
          ],
        });
        return;
      }
      tmpIDF = innerJoin(tmpIDF, nextDF, mergeColumn);
    } // End of for loop

    // Drop Site column; it should be coming from a user's metadata
    EASLDF = new DataFrame(tmpIDF.hasSeries("Site") ? tmpIDF.dropSeries("Site").toArray() : tmpIDF.toArray());

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
      // Remove columns that may cause issues when merging
      const initialMetadataDF = fromCSV(fetchMetaDF.data, { dynamicTyping: true });
      const colsToDrop = [];
      for (const colName of EASLColnamesNotPermittedInMetadata) {
        if (initialMetadataDF.hasSeries(colName)) {
          colsToDrop.push(colName);
        }
      }
      MetadataDF =
        colsToDrop.length > 0 ? new DataFrame(initialMetadataDF.dropSeries(colsToDrop).toArray()) : initialMetadataDF;

      console.log("Step 'Define Runtime Envs' -- MetadataDF: ", MetadataDF.toArray());
    } // End of if statement

    /**
     * Part 3: Merge the ExploreASL and Metadata dataframes
     */
    let mergedDF: DataFrame = null;
    if (MetadataDF) {
      // Sanity Check for main merge column existing
      if (!MetadataDF.getColumnNames().includes(mergeColumn)) {
        setDataVizSnackbar({
          severity: "error",
          title: `Could not find the column ${mergeColumn} in the Metadata dataframe`,
          message: [
            "Encountered the following error while loading dataframe:",
            `${values.MetadataPath}`,
            `The column: ${mergeColumn} is required for merging the ExploreASL and Metadata dataframes`,
          ],
        });
        return;
      }

      // Sanity Check for non-null values in merge columns
      let nullItems: number;
      if (!MetadataDF.hasSeries("session")) {
        nullItems = MetadataDF.getSeries(mergeColumn)
          .filter(val => val == null)
          .count();
      } else {
        nullItems = MetadataDF.subset([mergeColumn, "session"])
          .filter(row => row[mergeColumn] == null || row["session"] == null)
          .count();
      }
      if (nullItems > 0) {
        setDataVizSnackbar({
          severity: "error",
          title: `Empty values found in the ${mergeColumn} and/or session columns of the Metadata dataframe`,
          message: [
            `A proper merging of the ExploreASL and Metadata dataframes is impossible when there are empty values in the "${mergeColumn}" and/or "session" columns of the Metadata dataframe.`,
            " ",
            "Please remove rows with the empty values in this/these column(s) and try again.",
          ],
        });
        return;
      }

      // Perform an outer-left join on the ExploreASL and Metadata dataframes;
      // on SUBJECT and session if the latter is present; otherwise just on SUBJECT
      mergedDF = new DataFrame(
        outerLeftJoin(
          EASLDF,
          MetadataDF,
          MetadataDF.hasSeries("session") ? [mergeColumn, "session"] : mergeColumn
        ).toArray()
      );
    } else {
      mergedDF = EASLDF;
    }

    console.log("Step 'Define Runtime Envs' -- Merged Dataframe: ", mergedDF.toString());

    if (mergedDF.count() === 0) {
      MetadataDF != null
        ? setDataVizSnackbar({
            severity: "error",
            title: "Invalid Merge with Metadata",
            message: [
              "The ExploreASL and Metadata spreadsheet do not have any overlapping subjects/sessions.",
              "Ensure that the Metadata spreadsheet contains a SUBJECT column with the same subjects as the ExploreASL spreadsheet.",
              `The Metadata spreadsheet can also contain a "session" column.`,
              "Subject names are based on the subject folders located within the rawdata folder.",
            ],
          })
        : setDataVizSnackbar({
            severity: "error",
            title: "Error while loading ExploreASL Data",
            message: ["Failed to load and/or merge one or more ExploreASL spreadsheets."],
          });
      return;
    }

    /**
     * Part 4: Clean the dataframe and set the fields
     */
    const [dtypeMapping, cleanDF] = handleCleanRawDF(mergedDF);
    setDataVizLoadSettings(values); // Save the settings that were used to load the dataframe
    setGraphDataVariables(defaultNivoGraphDataVariablesSchema); // Reset the graph data variables
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
        <Card sx={{ marginBottom: 4 }}>
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
            action={
              <FabDialogWrapper maxWidth="xl" PaperProps={{ sx: { minWidth: "499px" } }} sx={{ marginTop: "40px" }}>
                <HelpDataViz__StepDefineDataframeLoc />
              </FabDialogWrapper>
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
