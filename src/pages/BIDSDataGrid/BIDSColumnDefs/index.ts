// ENUMS
export { BIDSEnumFields, BIDSEnumFieldsSet, isBIDSEnumField, BIDSEnumFieldToColDef } from "./BIDSEnumColDefs";
export type { BIDSEnumFieldsNameType, BIDSEnumColDef, BIDSEnumFieldToColDefType } from "./BIDSEnumColDefs";

// NUMERIC
export {
	BIDSNumericFields,
	BIDSNumericFieldsSet,
	isBIDSNumericField,
	BIDSNumericFieldToColDef,
} from "./BIDSNumericColDefs";
export type { BIDSNumericFieldsNameType, BIDSNumericColDef, BIDSNumericFieldToColDefType } from "./BIDSNumericColDefs";

// STRING/TEXT
export { BIDSTextFields, BIDSTextFieldsSet, isBIDSTextField, BIDSTextFieldToColDef } from "./BIDSTextColDefs";
export type { BIDSTextFieldsNameType, BIDSTextColDef, BIDSTextFieldToColDefType } from "./BIDSTextColDefs";

// BOOLEAN
export {
	BIDSBooleanFields,
	BIDSBooleanFieldsSet,
	isBIDSBooleanField,
	BIDSBooleanFieldToColDef,
} from "./BIDSBooleanColDefs";
export type { BIDSBooleanFieldsNameType, BIDSBooleanColDef, BIDSBooleanFieldToColDefType } from "./BIDSBooleanColDefs";

// MISC
export { MiscFields, MiscFieldsSet, isMiscField, MiscFieldToColDef } from "./BIDSMiscColDefs";
export type { MiscFieldsNameType, MiscColDef, MiscFieldToColDefType } from "./BIDSMiscColDefs";

// COMBINED
export {
	BIDSAllNonMiscFieldsSet,
	BIDSAllFieldsSet,
	isBIDSNonMiscField,
	isBIDSField,
	BIDSFieldNameToDisplayName,
} from "./BIDSMergeColDefs";
export type { BIDSAllNonMiscFieldsNameType, BIDSAllFieldsNameType, BIDSRow } from "./BIDSMergeColDefs";
