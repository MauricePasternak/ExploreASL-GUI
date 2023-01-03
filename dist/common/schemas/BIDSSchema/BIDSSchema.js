import { Schema_ASLSpecificFields, SchemaMin_ASLSpecificFields } from "./ASLSchema";
import { Schema_BackgroundSuppressionFields, SchemaMin_BackgroundSuppressionFields, } from "./BackgroundSuppressionSchema";
import { Schema_M0Fields, SchemaMin_M0Fields } from "./M0Schema";
import { Schema_BIDSMiscellaneousFields, SchemaMin_BIDSMiscellaneousFields } from "./MiscBIDSSchema";
import { Schema_MRTimingParameters, SchemaMin_MRTimingParameters } from "./MRTimingParametersSchema";
import { Schema_BIDSScannerHardwareFields, SchemaMin_BIDSScannerHardwareFields } from "./ScannerHardwareSchema";
import { Schema_SequenceSpecificFields, SchemaMin_SequenceSpecificFields } from "./SequenceSpecificsSchema";
/**
 * Minimum Schema for BIDS fields.
 * This schema is used for lenient validation (bare types are checked for, no additional tests for interdependent fields).
 */
export const SchemaMin_BIDS = SchemaMin_BIDSMiscellaneousFields.concat(SchemaMin_ASLSpecificFields)
    .concat(SchemaMin_BackgroundSuppressionFields)
    .concat(SchemaMin_M0Fields)
    .concat(SchemaMin_MRTimingParameters)
    .concat(SchemaMin_SequenceSpecificFields)
    .concat(SchemaMin_BIDSScannerHardwareFields);
/**
 * Strict Schema for BIDS fields.
 *
 * ⚠️ This schema features interdependent fields! It should NOT be used for lenient validation ⚠️
 */
export const Schema_BIDS = Schema_BIDSMiscellaneousFields.concat(Schema_ASLSpecificFields)
    .concat(Schema_BackgroundSuppressionFields)
    .concat(Schema_M0Fields)
    .concat(Schema_MRTimingParameters)
    .concat(Schema_SequenceSpecificFields)
    .concat(Schema_BIDSScannerHardwareFields);
//# sourceMappingURL=BIDSSchema.js.map