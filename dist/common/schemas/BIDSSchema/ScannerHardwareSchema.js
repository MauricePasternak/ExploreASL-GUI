import * as Yup from "yup";
// https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#scanner-hardware
/** Minimal schema to ensure Manufacturer is an **optional** string enum */
export const SchemaMin_Manufacturer = Yup.string()
    .oneOf(["Siemens", "GE", "Philips"], `Manufacturer must be one of the following: "Siemens", "GE", "Philips"`)
    .typeError(`Manufacturer must be one of the following: "Siemens", "GE", "Philips"`);
/** Expanded schema to ensure Manufacturer is also a required field */
export const Schema_Manufacturer = SchemaMin_Manufacturer.required("Manufacturer is a required field for ASL processing");
/** Minimal schema to ensure ManufacturersModelName is an **optional** string */
export const SchemaMin_ManufacturersModelName = Yup.string()
    .optional()
    .typeError("Manufacturer Model Name must be text if provided");
/** Minimal schema to ensure SoftwareVersions is an **optional** string */
export const SchemaMin_SoftwareVersions = Yup.string()
    .optional()
    .typeError("Software Versions must be text if provided");
/** Minimal schema to ensure MagneticFieldStrength is an **optional** number */
export const SchemaMin_MagneticFieldStrength = Yup.number()
    .typeError("Magnetic Field Strength must be a number")
    .positive("Magnetic Field Strength must be a positive number");
/** Expanded schema to ensure MagnaticFieldStrength is also a required field */
export const Schema_MagneticFieldStrength = SchemaMin_MagneticFieldStrength.required("Magnetic Field Strength is a required field for ASL processing");
/** Minimal schema to ensure ReceiveCoilName is an **optional** string */
export const SchemaMin_ReceiveCoilName = Yup.string()
    .optional()
    .typeError("Receive Coil Name must be text if provided");
/** Minimal schema to ensure ReceiveCoilActiveElements is an **optional** string */
export const SchemaMin_ReceiveCoilActiveElements = Yup.string()
    .optional()
    .typeError("Receive Coil Active Elements must be text if provided");
/** Minimal schema to ensure CoilCombinationMethod is an **optional** string */
export const SchemaMin_CoilCombinationMethod = Yup.string()
    .optional()
    .typeError("Coil Combination Method must be text if provided");
/**
 * Minimal schema for ScannerHardware-related fields (ScannerHardwareType, ScannerHardwareEstimate)
 * These cover the minimal requirement for being placeable into input fields like BIDSDataGrid
 */
export const SchemaMin_BIDSScannerHardwareFields = Yup.object().shape({
    Manufacturer: SchemaMin_Manufacturer,
    ManufacturersModelName: SchemaMin_ManufacturersModelName,
    SoftwareVersions: SchemaMin_SoftwareVersions,
    MagneticFieldStrength: SchemaMin_MagneticFieldStrength,
    ReceiveCoilName: SchemaMin_ReceiveCoilName,
    ReceiveCoilActiveElements: SchemaMin_ReceiveCoilActiveElements,
    CoilCombinationMethod: SchemaMin_CoilCombinationMethod,
});
/**
 * Schema for ScannerHardware-related fields (ScannerHardwareType, ScannerHardwareEstimate)
 * @see https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#scanner-hardware
 */
export const Schema_BIDSScannerHardwareFields = Yup.object().shape({
    Manufacturer: Schema_Manufacturer,
    ManufacturerModelName: SchemaMin_ManufacturersModelName,
    SoftwareVersions: SchemaMin_SoftwareVersions,
    MagneticFieldStrength: Schema_MagneticFieldStrength,
    ReceiveCoilName: SchemaMin_ReceiveCoilName,
    ReceiveCoilActiveElements: SchemaMin_ReceiveCoilActiveElements,
    CoilCombinationMethod: SchemaMin_CoilCombinationMethod,
});
//# sourceMappingURL=ScannerHardwareSchema.js.map