import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { cloneDeep as lodashCloneDeep } from "lodash";
import React from "react";
import { SubmitErrorHandler, SubmitHandler, useFieldArray } from "react-hook-form";
import ContextIcon from "../../assets/svg/ContextIcon.svg";
import { ImportSchemaType } from "../../common/types/ImportSchemaTypes";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../components/FormComponents/RHFMultiStep";
import FabDialogWrapper from "../../components/WrapperComponents/FabDialogWrapper";
import { DefaultImportSingleContext } from "../../stores/ImportPageStore";
import HelpImport__StepDefineAdditionalContext from "../Help/HelpImport__StepDefineAdditionalContext";
import SingleImportContext from "./SingleImportContext";

function StepDefineContexts({
  currentStep,
  setCurrentStep,
  control,
  handleSubmit,
}: RHFMultiStepReturnProps<ImportSchemaType>) {
  const { api } = window;
  const { fields, append, remove } = useFieldArray({ control: control, name: "ImportContexts" });

  console.log("Step 'Define Contexts' -- Render: fields", fields);

  const handleValidSubmit: SubmitHandler<ImportSchemaType> = async values => {
    console.log("Step 'Define Contexts' -- Valid Submit Values: ", values);

    // Save the values to an ImportPar.json file and proceed to the next step
    const pathImportPar = api.path.asPath(values.StudyRootPath, `ImportPar.json`);
    const createdJSONFile = await api.path.writeJSON(pathImportPar.path, values, { spaces: 2 });

    if (await api.path.filepathExists(createdJSONFile.path)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleInvalidSubmit: SubmitErrorHandler<ImportSchemaType> = errors => {
    console.debug("Step 'Define Content' -- Invalid Submit Errors: ", errors);
  };

  // TODO: During first render mount, there should be a useEffect here which loads an existing ImportPar.json file
  // created by the GUI and fills in the form fields with the values from the file.

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <Card elevation={3} sx={{ marginBottom: 2 }}>
        <CardHeader
          title={<Typography variant="h4">Define Additional Context</Typography>}
          subheader={
            <Typography>
              Define the specific nature of the ASL sequence acquisition to allow for the Import Module to properly
              convert the series into NIFTI format. Allows for multiple contexts for complex datasets.
            </Typography>
          }
          avatar={
            <Avatar>
              <SvgIcon component={ContextIcon} inheritViewBox />
            </Avatar>
          }
          action={
            <FabDialogWrapper
              maxWidth="xl"
              // fabProps={{ sx: { position: "absolute", top: "100px", right: "1rem", zIndex: 1 } }}
              PaperProps={{ sx: { minWidth: "499px" } }}
              sx={{ marginTop: "40px" }}
            >
              <HelpImport__StepDefineAdditionalContext />
            </FabDialogWrapper>
          }
        />
        <Divider />
        <CardContent>
          <Button
            fullWidth
            variant="contained"
            onClick={() => {
              const defaultContext = lodashCloneDeep(DefaultImportSingleContext);
              defaultContext.IsGlobal = false; // This allows for proper validation of the form.
              append(defaultContext);
            }}
          >
            Add a context
          </Button>
        </CardContent>
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            {fields.map((field, fieldIndex) => {
              return <SingleImportContext key={field.id} contextIndex={fieldIndex} remove={remove} control={control} />;
            })}
          </Stack>
        </CardContent>
      </Card>
      <RHFMultiStepButtons currentStep={currentStep} setCurrentStep={setCurrentStep} />
    </form>
  );
}

export default StepDefineContexts;
