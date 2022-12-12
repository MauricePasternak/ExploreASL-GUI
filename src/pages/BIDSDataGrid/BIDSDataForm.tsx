import { useAtom, useSetAtom } from "jotai";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { RHFFilepathInput } from "../../components/RHFComponents";
import { BIDSFormSchema } from "../../common/schemas/BIDSDataGridSchemas/BIDSFormSchema";
import { YupResolverFactoryBase } from "../../common/utils/formFunctions";
import {
	atomBIDSColumnNames,
	atomBIDSErrors,
	atomBIDSRows,
	atomBIDSStudyRootPath,
	atomSetFetchBIDSDataFrame,
} from "../../stores/BIDSDataGridStore";
import { BIDSErrorMapping } from "./BIDSErrors";

function BIDSDataForm() {
	const [BIDSStudyRootPath, setBIDSStudyRootPath] = useAtom(atomBIDSStudyRootPath);
	const setBIDSRows = useSetAtom(atomBIDSRows);
	const setBIDSColumnNames = useSetAtom(atomBIDSColumnNames);
	const setBIDSErrors = useSetAtom(atomBIDSErrors);
	const handleFetchDataFrame = useSetAtom(atomSetFetchBIDSDataFrame);
	const { control, trigger, watch } = useForm({
		defaultValues: {
			StudyRootPath: BIDSStudyRootPath,
		},
		resolver: YupResolverFactoryBase(BIDSFormSchema),
	});

	useEffect(() => {
		const subscription = watch(async (value) => {
			const isValid = await trigger("StudyRootPath");
			console.log("BIDSDataForm's useEffect has triggered:", { isValid, value });
			if (isValid) {
				console.log("BIDSDataForm: Setting BIDSStudyRootPath:", value.StudyRootPath);
				setBIDSStudyRootPath(value.StudyRootPath);
				await handleFetchDataFrame(value.StudyRootPath);
			} else {
				console.log("BIDSDataForm: Setting BIDS DF to empty");
				setBIDSStudyRootPath("");
				setBIDSRows([]);
				setBIDSColumnNames([]);
				setBIDSErrors({} as BIDSErrorMapping);
			}
		});
		return () => subscription.unsubscribe();
	}, [watch]);

	return (
		<form style={{ marginTop: "8px" }}>
			<RHFFilepathInput
				control={control}
				name="StudyRootPath"
				filepathType="dir"
				dialogOptions={{ properties: ["openDirectory"], title: "Select Study Root Directory" }}
				label="Study Root Path"
				helperText="This is the root of your dataset"
			/>
		</form>
	);
}

export default React.memo(BIDSDataForm);
