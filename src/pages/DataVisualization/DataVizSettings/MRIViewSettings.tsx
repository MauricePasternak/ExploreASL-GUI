import React from "react";
import TuneIcon from "@mui/icons-material/Tune";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import ExpandMore from "../../../components/ExpandMore";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CardContent from "@mui/material/CardContent";
import Collapse from "@mui/material/Collapse";
import { useAtom, useAtomValue } from "jotai";
import {
  atomCurrentAxialSlice,
  atomCurrentCoronalSlice,
  atomCurrentSagittalSlice,
  atomOfAtomMRISlices,
} from "../../../stores/DataFrameVisualizationStore";
import FormControl from "@mui/material/FormControl";
import Stack from "@mui/material/Stack";
import FormLabel from "@mui/material/FormLabel";
import Slider from "@mui/material/Slider";
import MRIViewSlider from "./MRIViewSlider";

function MRIViewSettings() {
  const [expanded, setExpanded] = React.useState(true);
  const atomsMRISlices = useAtomValue(atomOfAtomMRISlices);

  return (
    <Card elevation={1} sx={{ margin: 0.5 }}>
      <CardHeader
        title={<Typography variant="h5">MRI View Controls</Typography>}
        subheader={<Typography variant="subtitle1">Control visuals related to the MRI images</Typography>}
        avatar={
          <Avatar>
            <TuneIcon />
          </Avatar>
        }
        action={
          <ExpandMore
            expand={expanded}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label="show more"
          >
            <ExpandMoreIcon />
          </ExpandMore>
        }
      />
      <Collapse in={expanded}>
        <CardContent>
          <Stack spacing={2}>
            {atomsMRISlices.map((atomMRISlice, idx) => {
              const orientation = idx === 0 ? "Axial" : idx === 1 ? "Coronal" : "Sagittal";
              const maxPermitted = orientation === "Coronal" ? 144 : 120; // 1 less due to indexing
              return (
                <MRIViewSlider
                  key={`${atomMRISlice}`}
                  atomMRISlice={atomMRISlice}
                  label={orientation}
                  max={maxPermitted}
                />
              );
            })}
          </Stack>
        </CardContent>
      </Collapse>
    </Card>
  );
}

export default MRIViewSettings;
