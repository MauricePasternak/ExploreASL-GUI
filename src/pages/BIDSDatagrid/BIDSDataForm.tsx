import { DataFrame } from "data-forge";
import { useAtom, useSetAtom } from "jotai";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { BIDSFormSchema } from "../../common/schemas/BIDSFormSchema";
import { YupResolverFactoryBase } from "../../common/utilityFunctions/formFunctions";
import RHFFilepathTextField from "../../components/FormComponents/RHFFilepathTextfield";
import { atomBIDSDataframe, atomBIDSStudyRootPath, atomDataframeColumns } from "../../stores/BIDSDatagridStore";

function BIDSDataForm() {
  const [BIDSStudyRootPath, setBIDSStudyRootPath] = useAtom(atomBIDSStudyRootPath);
  const setBIDSDataframeColumns = useSetAtom(atomDataframeColumns);
  const setBIDSDF = useSetAtom(atomBIDSDataframe);

  const { control, trigger, watch } = useForm({
    defaultValues: {
      StudyRootPath: BIDSStudyRootPath,
    },
    resolver: YupResolverFactoryBase(BIDSFormSchema),
  });

  useEffect(() => {
    const subscription = watch(async value => {
      const isValid = await trigger("StudyRootPath");
      console.log("BIDSDataForm's useEffect has triggered:", { isValid, value });
      if (isValid) {
        console.log("BIDSDataForm: Setting BIDSStudyRootPath:", value.StudyRootPath);
        setBIDSStudyRootPath(value.StudyRootPath);
      } else {
        console.log("BIDSDataForm setting BIDS DF to empty");
        setBIDSStudyRootPath("");
        setBIDSDF(new DataFrame());
        setBIDSDataframeColumns([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  return (
    <form style={{ marginTop: "8px" }}>
      <RHFFilepathTextField
        control={control}
        name="StudyRootPath"
        filepathType="dir"
        dialogOptions={{ properties: ["openDirectory"] }}
        label="Study Root Path"
        helperText="This is the root of your dataset"
      />
    </form>
  );
}

export default React.memo(BIDSDataForm);
