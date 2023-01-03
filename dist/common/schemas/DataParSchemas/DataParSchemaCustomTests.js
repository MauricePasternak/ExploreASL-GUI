var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { yupCreateError } from "../../utils/formFunctions";
import { AreValidSubjects } from "../../utils/EASLFunctions";
export const DataParModule__SUBJECTSTest = (subjectBasenames, helpers) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("🚀 ~ DataParModule__SUBJECTSTest ~ subjectBasenames", subjectBasenames);
    if (subjectBasenames.length < 1) {
        return yupCreateError(helpers, "At least one subject is required");
    }
    console.log(`DataParSchema -- SUBJECTS field -- subjectBasenames`, subjectBasenames);
    if (!subjectBasenames || !Array.isArray(subjectBasenames) || !subjectBasenames.length) {
        return yupCreateError(helpers, "Invalid value provided for the listing of subjects");
    }
    return yield AreValidSubjects(subjectBasenames, helpers);
});
export const DataParModule__ApplyQuantificationTest = (values) => {
    return Array.isArray(values) && values.every((v) => v === 0 || v === 1);
};
//# sourceMappingURL=DataParSchemaCustomTests.js.map