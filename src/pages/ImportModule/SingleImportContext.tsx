import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { partialRight as lodashPartialRight, range as lodashRange } from "lodash";
import React from "react";
import { Control, UseFieldArrayRemove, UseFormTrigger } from "react-hook-form";
import RHFInterDepSelect from "../../components/FormComponents/RHFInterDepSelect";
import { ImportSchemaType } from "../../common/types/ImportSchemaTypes";
import { getNumbersFromDelimitedString } from "../../common/utilityFunctions/stringFunctions";
import ExpandMore from "../../components/ExpandMore";
import RHFFilepathDropzone from "../../components/FormComponents/RHFFilepathDropzone";
import RHFInterDepSlider from "../../components/FormComponents/RHFInterDepSlider";
import RHFSelect, { RHFControlledSelectOption } from "../../components/FormComponents/RHFSelect";
import RHFSingleCheckable from "../../components/FormComponents/RHFSingleCheckable";
import RHFSlider from "../../components/FormComponents/RHFSlider";
import RHFTextfield from "../../components/FormComponents/RHFTextfield";
import OutlinedGroupBox from "../../components/OutlinedGroupBox";
import RHFInterDepSingleCheckable from "../../components/FormComponents/RHFInterDepSingleCheckable";

type SingleImportContextProps = {
  contextIndex: number;
  control: Control<ImportSchemaType>;
  remove: UseFieldArrayRemove;
  trigger: UseFormTrigger<ImportSchemaType>;
};

function SingleImportContext({ contextIndex, control, remove, trigger }: SingleImportContextProps) {
  const isFirst = contextIndex === 0;
  const [expanded, setExpanded] = React.useState(true);

  return (
    <Card>
      <CardHeader
        title={
          isFirst ? (
            <Typography variant="h6">Global Context</Typography>
          ) : (
            <Typography variant="h6">Additional Context {contextIndex}</Typography>
          )
        }
        subheader={
          isFirst && (
            <Typography>
              This context will apply to all subjects that have not been specified in any other contexts. If this is the
              only context, then it applies to all subjects under sourcedata.
            </Typography>
          )
        }
        avatar={
          <ExpandMore expand={expanded} onClick={() => setExpanded(!expanded)}>
            <ExpandMoreIcon />
          </ExpandMore>
        }
        action={
          <Box>
            {!isFirst && (
              <IconButton onClick={() => remove(contextIndex)}>
                <CloseIcon />
              </IconButton>
            )}
          </Box>
        }
      />
      <Divider />
      <Collapse in={expanded}>
        <CardContent>
          {!isFirst && (
            <RHFFilepathDropzone
              control={control}
              name={`ImportContexts.${contextIndex}.Paths`}
              filepathType="dir"
              dialogOptions={{ properties: ["multiSelections", "openDirectory"] }}
              label="Subjects/Visits/Sessions Within this Context"
              helperText="Drop Subject, Visit, and/or Session folders into this field to indicate that these are the items that are encompassed by this context."
              placeholderText="Drop Folders Here"
            />
          )}

          <OutlinedGroupBox
            label="ASL Context"
            mt={3}
            labelBackgroundColor={theme => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
          >
            <Grid container rowSpacing={3} columnSpacing={3} marginTop={-2} padding={2} alignItems="center">
              <Grid item xs={12} md={6} xl={3}>
                <RHFSelect
                  control={control}
                  name={`ImportContexts.${contextIndex}.ASLSeriesPattern`}
                  label="ASL Series Pattern"
                  options={[
                    { label: "Alternating Control, Label Series", value: "control-label" },
                    { label: "Alternating Label, Control Series", value: "label-control" },
                    { label: "Intermediate Perfusion Weighted Image", value: "deltam" },
                    { label: "Complete Perfusion (CBF) Image", value: "cbf" },
                  ]}
                  helperText="Describes the general pattern of the ASL series (i.e. does it alternate between control and label volumes?)."
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFSlider
                  control={control}
                  name={`ImportContexts.${contextIndex}.NVolumes`}
                  label="Number of Volumes in ASL Series"
                  min={1}
                  step={1}
                  max={250}
                  renderTextfields
                  helperText="The number of volumes in the ASL series."
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFTextfield
                  control={control}
                  name={`ImportContexts.${contextIndex}.M0PositionInASL`}
                  label="M0 Positions within ASL Series"
                  fullWidth
                  debounceTime={2000}
                  helperText="Specify as comma-separated positive integers. Leave blank if not applicable."
                  handleInnerToField={getNumbersFromDelimitedString}
                  handleFieldToInner={(numbers: number[]) =>
                    numbers && Array.isArray(numbers) ? numbers.join(", ") : ""
                  }
                  shouldUpdateAfterDebounce
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFTextfield
                  control={control}
                  name={`ImportContexts.${contextIndex}.DummyPositionInASL`}
                  label="Dummy Positions within ASL Series"
                  fullWidth
                  debounceTime={2000}
                  helperText="Specify as comma-separated positive integers. Leave blank if not applicable."
                  handleInnerToField={getNumbersFromDelimitedString}
                  handleFieldToInner={(numbers: number[]) =>
                    numbers && Array.isArray(numbers) ? numbers.join(", ") : ""
                  }
                  shouldUpdateAfterDebounce
                />
              </Grid>
            </Grid>
          </OutlinedGroupBox>
          <OutlinedGroupBox
            label="Additional ASL Sequence Information"
            mt={5}
            labelBackgroundColor={theme => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
          >
            <Grid container rowSpacing={3} columnSpacing={3} marginTop={-2} padding={2} alignItems="center">
              <Grid item xs={12} md={6} xl={3}>
                <RHFSingleCheckable
                  control={control}
                  name={`ImportContexts.${contextIndex}.M0IsSeparate`}
                  label="An M0 scan was acquired separately"
                  helperText="Check this box if an M0 scan is acquired as a separate DICOM series"
                  valWhenChecked={true}
                  valWhenUnchecked={false}
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFSelect
                  control={control}
                  name={`ImportContexts.${contextIndex}.ASLManufacturer`}
                  label="Scanner Manufacturer"
                  helperText="The manufacturer of the scanner used to acquire the ASL series."
                  options={[
                    { label: "General Electric (GE)", value: "GE" },
                    { label: "Philips", value: "Philips" },
                    { label: "Siemens", value: "Siemens" },
                  ]}
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFInterDepSelect
                  control={control}
                  name={`ImportContexts.${contextIndex}.ASLSequence`}
                  label="ASL Sequence Type"
                  helperText="The type of ASL sequence used"
                  options={[
                    { label: "Pulsed ASL", value: "PASL" },
                    { label: "Pseudo-continuous ASL", value: "PCASL" },
                    { label: "Continuous ASL", value: "CASL" },
                  ]}
                  trigger={trigger}
                  triggerTarget={[
                    `ImportContexts.${contextIndex}.BolusCutOffFlag`,
                    `ImportContexts.${contextIndex}.LabelingDuration`,
                  ]}
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFSlider
                  control={control}
                  name={`ImportContexts.${contextIndex}.PostLabelingDelay`}
                  min={0}
                  max={5}
                  step={0.001}
                  renderTextfields
                  label="Post Labeling Delay"
                  helperText="Units are in seconds. If you want this field ignored, set to 0."
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFSlider
                  control={control}
                  name={`ImportContexts.${contextIndex}.LabelingDuration`}
                  min={0}
                  max={5}
                  step={0.001}
                  renderTextfields
                  label="Labeling Duration"
                  helperText="Units are in seconds. If you want this field ignored, set to 0."
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFInterDepSingleCheckable
                  control={control}
                  name={`ImportContexts.${contextIndex}.BolusCutOffFlag`}
                  trigger={trigger}
                  triggerTarget={`ImportContexts.${contextIndex}.BolusCutOffTechnique`}
                  label="Bolus Cut-Off Flag"
                  helperText="Was a bolus cut-off technique used? (checked if yes)"
                  valWhenChecked={true}
                  valWhenUnchecked={false}
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFInterDepSelect
                  control={control}
                  name={`ImportContexts.${contextIndex}.BolusCutOffTechnique`}
                  label="Bolus Cut-Off Technique"
                  helperText="The technique used to perform the bolus cut-off."
                  options={[
                    { label: "No technique was used", value: "" },
                    { label: "QUIPSS", value: "QUIPSS" },
                    { label: "QUIPSSII", value: "QUIPSSII" },
                    { label: "Q2TIPS", value: "Q2TIPS" },
                  ]}
                  trigger={trigger}
                  triggerTarget={[
                    `ImportContexts.${contextIndex}.BolusCutOffFlag`,
                    `ImportContexts.${contextIndex}.BolusCutOffDelayTime`,
                  ]}
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFSlider
                  control={control}
                  name={`ImportContexts.${contextIndex}.BolusCutOffDelayTime`}
                  min={0}
                  max={5}
                  step={0.001}
                  renderTextfields
                  label="Bolus Cut-Off Delay Time"
                  helperText="Units are in seconds. If you want this field ignored, set to 0."
                />
              </Grid>
            </Grid>
          </OutlinedGroupBox>
          <OutlinedGroupBox
            label="Background Suppression Information"
            mt={5}
            labelBackgroundColor={theme => (theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff")}
          >
            <Grid container rowSpacing={3} columnSpacing={3} marginTop={-2} padding={2} alignItems="center">
              <Grid item xs={12} md={6} xl={3}>
                <RHFInterDepSlider
                  control={control}
                  name={`ImportContexts.${contextIndex}.BackgroundSuppressionNumberPulses`}
                  trigger={trigger}
                  triggerTarget={`ImportContexts.${contextIndex}.BackgroundSuppressionPulseTime`}
                  label="Number of Background Suppression Pulses"
                  min={0}
                  max={10}
                  step={1}
                  marks={lodashRange(11).map(n => ({ label: `${n}`, value: n }))}
                />
              </Grid>
              <Grid item xs={12} md={6} xl={3}>
                <RHFTextfield
                  control={control}
                  name={`ImportContexts.${contextIndex}.BackgroundSuppressionPulseTime`}
                  fullWidth
                  label="Background Pulse Suppression Timings"
                  helperText="Specify as comma-separated positive numbers in seconds. Leave blank if not applicable."
                  handleInnerToField={lodashPartialRight(getNumbersFromDelimitedString, ",", "float")}
                  handleFieldToInner={(numbers: number[]) =>
                    numbers && Array.isArray(numbers) ? numbers.join(", ") : ""
                  }
                  debounceTime={2000}
                  shouldUpdateAfterDebounce
                />
              </Grid>
            </Grid>
          </OutlinedGroupBox>
        </CardContent>
      </Collapse>
    </Card>
  );
}

export default SingleImportContext;
