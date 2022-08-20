import * as Yup from "yup";
import { BIDSFieldNamesType } from "../types/BIDSDatagridTypes";
import { YupShape } from "./ImportSchema";

export const BIDSRowSchema = Yup.object().shape<YupShape<Record<BIDSFieldNamesType, unknown>>>({
  // Enum fields
  ArterialSpinLabelingType: Yup.string().oneOf(["CASL", "PCASL", "PASL"], "Invalid Arterial Spin Labeling Type"),
  Manufacturer: Yup.string().oneOf(["GE", "Siemens", "Philips"], "Invalid Manufacturer"),
  M0Type: Yup.string()
    .oneOf(["Separate", "Included", "Estimate", "Absent"], "Invalid M0 Type")
    .test("M0Type", "Invalid M0 Type", (M0Type, helpers) => {
      const M0Estimate = helpers.parent?.M0Estimate;
      if (M0Type === "Estimate" && M0Estimate == null) {
        return helpers.createError({
          message: `If M0 Type is indicated as "Single Value Estimate", then "M0 Single Value Estimate" must be a field in the spreadsheet`,
        });
      }
      return true;
    }),
  MRAcquisitionType: Yup.string().oneOf(["2D", "3D"], "Invalid MRI Readout Dimensionality"),
  CASLType: Yup.string().test("CASL Type", "Invalid CASL Type", (CASLType, helpers) => {
    const PCASLType = helpers.parent?.PCASLType;
    const PASLType = helpers.parent?.PASLType;
    if (!!PCASLType || !!PASLType)
      return helpers.createError({
        message: "CASL Type cannot be set if PCASL Type or PASL Type is set",
      });
    return ["single-coil", "double-coil"].includes(CASLType);
  }),
  PCASLType: Yup.string().test("PCASL Type", "Invalid PCASL Type", (PCASLType, helpers) => {
    const CASLType = helpers.parent?.CASLType;
    const PASLType = helpers.parent?.PASLType;
    if (!!CASLType || !!PASLType)
      return helpers.createError({
        message: "PCASL Type cannot be set if CASL Type or PASL Type is set",
      });
    return ["balanced", "unbalanced"].includes(PCASLType);
  }),
  PASLType: Yup.string().test("PASL Type", "Invalid PASL Type", (PASLType, helpers) => {
    const CASLType = helpers.parent?.CASLType;
    const PCASLType = helpers.parent?.PCASLType;
    if (!!CASLType || !!PCASLType)
      return helpers.createError({
        message: "PASL Type cannot be set if CASL Type or PCASL Type is set",
      });
    return ["FAIR", "EPISTAR", "PICORE"].includes(PASLType);
  }),
  PhaseEncodingDirection: Yup.string()
    .oneOf(["i", "j", "k", "i-", "j-", "k-"], "Invalid Phase Encoding Direction")
    .test(
      "PhaseEncodingDirection",
      "Phase Encoding Direction cannot be the same as the Slice Encoding Direction",
      (val, helpers) => {
        const sliceEncDir = helpers.parent?.SliceEncodingDirection;
        return sliceEncDir !== val;
      }
    ),
  SliceEncodingDirection: Yup.string()
    .oneOf(["i", "j", "k", "i-", "j-", "k-"], "Invalid Slice Encoding Direction")
    .test(
      "SliceEncodingDirection",
      "Slice Encoding Direction cannot be the same as the Phase Encoding Direction",
      (val, helpers) => {
        const phaseEncDir = helpers.parent?.PhaseEncodingDirection;
        return phaseEncDir !== val;
      }
    ),
  BolusCutOffTechnique: Yup.string().test(
    "Valid Bolus Cut Off Technique",
    "Invalid Bolus Cut Off Technique value",
    (bolusCutOffTechnique, helpers) => {
      // Must be omitted when certain other fields are present
      const bolusCutOffFlag = helpers.parent?.BolusCutOffFlag;
      const CASLType = helpers.parent?.CASLType;
      const PCASLType = helpers.parent?.PCASLType;

      if (!!CASLType || !!PCASLType)
        return helpers.createError({
          message: "Bolus Cut Off Technique must be omitted when CASL Type or PCASL Type is present",
        });

      if (!!bolusCutOffFlag)
        return helpers.createError({
          message: "Bolus Cut Off Technique must be omitted when Bolus Cut Off Flag is absent or set to false.",
        });

      return ["Q2TIPS", "QUIPSS", "QUIPSSII"].includes(bolusCutOffTechnique);
    }
  ),
  // Numerical fields
  EchoTime: Yup.number().moreThan(0, "Invalid Echo Time"),
  RepetitionTime: Yup.number().moreThan(0, "Invalid Repetition Time"),
  FlipAngle: Yup.number().min(0, "Invalid Flip Angle").max(360, "Invalid Flip Angle"),
  MagneticFieldStrength: Yup.number().moreThan(0, "Invalid Magnetic Field Strength"),
  PostLabelingDelay: Yup.number().moreThan(0, "Invalid Post Labeling Delay"),
  LabelingDuration: Yup.number().moreThan(0, "Invalid Labeling Duration"),
  M0_GMScaleFactor: Yup.number().moreThan(0, "Invalid M0 GM Scale Factor"),
  M0Estimate: Yup.number().moreThan(0, "Invalid M0 Estimate"),


});
