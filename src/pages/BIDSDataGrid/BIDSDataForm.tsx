import { useSetAtom } from "jotai";
import React, { useEffect } from "react";
import { SubmitErrorHandler, SubmitHandler, useForm } from "react-hook-form";
import * as Yup from "yup";
import { Schema_StudyRootPathPostImport } from "../../common/schemas/CommonSchemas/EASLGUIPathsSchema";
import { YupShape } from "../../common/types/validationSchemaTypes";
import { YupResolverFactoryBase } from "../../common/utils/formFunctions";
import { RHFFilepathInput } from "../../components/RHFComponents";
import {
	atomBIDSColumnNames,
	atomBIDSErrors,
	atomBIDSRows,
	atomBIDSStudyRootPath,
	atomSetFetchBIDSDataFrame,
} from "../../stores/BIDSDataGridStore";
import { BIDSErrorMapping } from "./BIDSErrors";

type BIDSFormValuesType = {
	studyRootPath: string;
};

const BIDSFormValuesDefault: BIDSFormValuesType = {
	studyRootPath: "",
};

const BIDSFormValuesSchema = Yup.object().shape<YupShape<BIDSFormValuesType>>({
	studyRootPath: Schema_StudyRootPathPostImport,
});

function BIDSDataForm() {
	const setBIDSStudyRootPath = useSetAtom(atomBIDSStudyRootPath);
	const setBIDSRows = useSetAtom(atomBIDSRows);
	const setBIDSColumnNames = useSetAtom(atomBIDSColumnNames);
	const setBIDSErrors = useSetAtom(atomBIDSErrors);
	const handleFetchDataFrame = useSetAtom(atomSetFetchBIDSDataFrame);
	const { control, watch, handleSubmit } = useForm<BIDSFormValuesType>({
		defaultValues: BIDSFormValuesDefault,
		resolver: YupResolverFactoryBase(BIDSFormValuesSchema),
	});

	const handleValidSubmit: SubmitHandler<BIDSFormValuesType> = async (value) => {
		console.log("BIDSDataForm: Setting BIDSStudyRootPath:", value.studyRootPath);
		setBIDSStudyRootPath(value.studyRootPath);
		handleFetchDataFrame(value.studyRootPath);
	};

	const handleInvalidSubmit: SubmitErrorHandler<BIDSFormValuesType> = (errors) => {
		console.log("BIDSDataForm: Setting BIDS DF to empty");
		setBIDSStudyRootPath("");
		setBIDSRows([]);
		setBIDSColumnNames([]);
		setBIDSErrors({} as BIDSErrorMapping);
	};

	useEffect(() => {
		const subscription = watch(async (value) => {
			handleSubmit(handleValidSubmit, handleInvalidSubmit)();
		});
		return () => subscription.unsubscribe();
	}, [watch]);

	return (
		<form style={{ marginTop: "8px" }}>
			<RHFFilepathInput
				control={control}
				name="studyRootPath"
				filepathType="dir"
				dialogOptions={{ properties: ["openDirectory"], title: "Select Study Root Directory" }}
				label="Study Root Path"
				helperText={`This is the root of your BIDS dataset. It should contain the folders "sourcedata", "rawdata", and "derivatives"`}
				debounceTime={1000}
			/>
		</form>
	);
}

export default React.memo(BIDSDataForm);
