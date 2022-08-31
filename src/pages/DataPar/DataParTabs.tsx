import CalculateIcon from "@mui/icons-material/Calculate";
import ErrorIcon from "@mui/icons-material/Error";
import PeopleIcon from "@mui/icons-material/People";
import Paper from "@mui/material/Paper";
import SvgIcon from "@mui/material/SvgIcon";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { FieldValues, Path, UseFormReturn, useFormState } from "react-hook-form";
import ProcessIcon from "../../assets/svg/ArrowsSpinSolid.svg";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { DataParTabOption } from "../../common/types/DataParSchemaTypes";
import { DataParValuesType } from "../../common/types/ExploreASLDataParTypes";
import { parseNestedFormattedYupErrors } from "../../common/utilityFunctions/formFunctions";
import { atomDataParCurrentTab } from "../../stores/DataParStore";
import { atomCurrentGUIPage } from "../../stores/GUIFrameStore";

type DataParTabProps<TFV extends FieldValues> = {
  label: React.ReactNode;
  fieldNames: Path<TFV>[];
  icon?: React.ReactElement;
};

const dataParTabs: Record<DataParTabOption, DataParTabProps<DataParValuesType>> = {
  StudyParameters: {
    label: "Study Parameters",
    fieldNames: [
      "x.GUI.EASLPath",
      "x.GUI.EASLType",
      "x.GUI.StudyRootPath",
      "x.GUI.SUBJECTS",
      "x.GUI.MATLABRuntimePath",
      "x.dataset.exclusion",
      "x.dataset.name",
    ],
    icon: <PeopleIcon />,
  },
  SequenceParameters: {
    label: "Sequence Parameters",
    fieldNames: [
      "x.Q.Vendor",
      "x.Q.Sequence",
      "x.Q.readoutDim",
      "x.Q.LabelingType",
      "x.Q.M0",
      "x.Q.BackgroundSuppressionNumberPulses",
      "x.Q.BackgroundSuppressionPulseTime",
      "x.Q.Initial_PLD",
      "x.Q.LabelingDuration",
      "x.Q.SliceReadoutTime",
      "x.Q.bUseBasilQuantification",
      "x.Q.Lambda",
      "x.Q.T2art",
      "x.Q.BloodT1",
      "x.Q.TissueT1",
      "x.Q.nCompartments",
      "x.Q.ApplyQuantification",
      "x.Q.SaveCBF4D",
    ],
    icon: <CalculateIcon />,
  },
  ProcessParameters: {
    label: "Processing Parameters",
    fieldNames: [
      "x.modules.asl.M0_conventionalProcessing",
      "x.modules.asl.M0_GMScaleFactor",
      "x.modules.asl.motionCorrection",
      "x.modules.asl.SpikeRemovalThreshold",
      "x.modules.asl.bRegistrationContrast",
      "x.modules.asl.bAffineRegistration",
      "x.modules.asl.bDCTRegistration",
      "x.modules.asl.bRegisterM02ASL",
      "x.modules.asl.bUseMNIasDummyStructural",
      "x.modules.asl.bPVCNativeSpace",
      "x.modules.asl.PVCNativeSpaceKernel",
      "x.modules.asl.bPVCGaussianMM",
      "x.modules.asl.MakeNIfTI4DICOM",
      "x.modules.bRunLongReg",
      "x.modules.bRunDARTEL",
      "x.modules.structural.bSegmentSPM12",
      "x.modules.structural.bHammersCAT12",
      "x.modules.structural.bFixResolution",
      "x.settings.Quality",
      "x.settings.DELETETEMP",
      "x.settings.SkipIfNoFlair",
      "x.settings.SkipIfNoASL",
      "x.settings.SkipIfNoM0",
      "x.S.bMasking",
      "x.S.Atlases",
    ],
    icon: <SvgIcon component={ProcessIcon} inheritViewBox />,
  },
};

function DataParTabs({ control }: UseFormReturn<DataParValuesType>) {
  const [currentTab, setCurrentTab] = useAtom(atomDataParCurrentTab);
  const currentTabsSchema = dataParTabs[currentTab];
  const { errors } = useFormState({ control: control, name: currentTabsSchema.fieldNames });
  const errKeys = Object.keys(parseNestedFormattedYupErrors(errors));
  const currentGUIPage = useAtomValue(atomCurrentGUIPage);

  return (
    <Paper
      elevation={2}
      sx={{
        position: "sticky",
        top: APPBARHEIGHTPIXELS,
        zIndex: 10,
      }}
    >
      {currentGUIPage === "DataPar" && (
        <Tabs
          variant="scrollable"
          scrollButtons
          allowScrollButtonsMobile
          value={currentTab}
          onChange={(e, v) => setCurrentTab(v)}
          sx={{
            // left: "50%",
            // transform: "translateX(-50%)",
            width: "100%",

            justifyContent: "center",
            "& .MuiTabs-scroller": {
              flexGrow: 0,
            },

            "& .MuiTabs-indicator": {
              backgroundColor: errKeys.length > 0 ? "error.main" : "default",
            },
          }}
        >
          {Object.entries(dataParTabs).map(([tab, { label, fieldNames, icon }]) => {
            const containsError = errKeys.some((key: Path<DataParValuesType>) => fieldNames.includes(key));
            // console.log(`DataParTab with label: ${label} contains error: ${containsError}`);

            return (
              <Tab
                key={`DataParTab_${label}`}
                sx={{
                  color: containsError ? "error.main" : "default",
                  "&.Mui-selected": {
                    color: containsError ? "error.main" : "default",
                  },
                  "&.Mui-selected svg": {
                    fill: theme => (containsError ? theme.palette.error.main : theme.palette.primary.main),
                  },
                }}
                label={label}
                value={tab}
                icon={containsError ? <ErrorIcon /> : icon}
                iconPosition="start"
              />
            );
          })}
        </Tabs>
      )}
    </Paper>
  );
}

export default DataParTabs;
