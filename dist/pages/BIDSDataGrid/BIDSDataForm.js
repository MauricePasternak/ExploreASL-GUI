var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { useSetAtom } from "jotai";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import * as Yup from "yup";
import { Schema_StudyRootPathPostImport } from "../../common/schemas/CommonSchemas/EASLGUIPathsSchema";
import { YupResolverFactoryBase } from "../../common/utils/formFunctions";
import { RHFFilepathInput } from "../../components/RHFComponents";
import { atomBIDSColumnNames, atomBIDSErrors, atomBIDSRows, atomBIDSStudyRootPath, atomSetFetchBIDSDataFrame, } from "../../stores/BIDSDataGridStore";
const BIDSFormValuesDefault = {
    studyRootPath: "",
};
const BIDSFormValuesSchema = Yup.object().shape({
    studyRootPath: Schema_StudyRootPathPostImport,
});
function BIDSDataForm() {
    const setBIDSStudyRootPath = useSetAtom(atomBIDSStudyRootPath);
    const setBIDSRows = useSetAtom(atomBIDSRows);
    const setBIDSColumnNames = useSetAtom(atomBIDSColumnNames);
    const setBIDSErrors = useSetAtom(atomBIDSErrors);
    const handleFetchDataFrame = useSetAtom(atomSetFetchBIDSDataFrame);
    const { control, watch, handleSubmit } = useForm({
        defaultValues: BIDSFormValuesDefault,
        resolver: YupResolverFactoryBase(BIDSFormValuesSchema),
    });
    const handleValidSubmit = (value) => __awaiter(this, void 0, void 0, function* () {
        console.log("BIDSDataForm: Setting BIDSStudyRootPath:", value.studyRootPath);
        setBIDSStudyRootPath(value.studyRootPath);
        handleFetchDataFrame(value.studyRootPath);
    });
    const handleInvalidSubmit = (errors) => {
        console.log("BIDSDataForm: Setting BIDS DF to empty");
        setBIDSStudyRootPath("");
        setBIDSRows([]);
        setBIDSColumnNames([]);
        setBIDSErrors({});
    };
    useEffect(() => {
        const subscription = watch((value) => __awaiter(this, void 0, void 0, function* () {
            handleSubmit(handleValidSubmit, handleInvalidSubmit)();
        }));
        return () => subscription.unsubscribe();
    }, [watch]);
    return (React.createElement("form", { style: { marginTop: "8px" } },
        React.createElement(RHFFilepathInput, { control: control, name: "studyRootPath", filepathType: "dir", dialogOptions: { properties: ["openDirectory"], title: "Select Study Root Directory" }, label: "Study Root Path", helperText: `This is the root of your BIDS dataset. It should contain the folders "sourcedata", "rawdata", and "derivatives"`, debounceTime: 1000 })));
}
export default React.memo(BIDSDataForm);
//# sourceMappingURL=BIDSDataForm.js.map