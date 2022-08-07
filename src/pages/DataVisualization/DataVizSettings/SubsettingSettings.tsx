import React from "react";
import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import ExpandMore from "../../../components/ExpandMore";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CardContent from "@mui/material/CardContent";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import { useAtomValue, useSetAtom } from "jotai";
import { atomOfAtomsDataVizSubsetOperations, atomSetAddPredicate } from "../../../stores/DataFrameVisualizationStore";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import SingleSubsetter from "./SingleSubsetter";

function SubsettingSettings() {
  const [expanded, setExpanded] = React.useState(true);
  const atomsSubsetOperations = useAtomValue(atomOfAtomsDataVizSubsetOperations);
  const addSubsetOperation = useSetAtom(atomSetAddPredicate);
  return (
    <Card elevation={1} sx={{ margin: 0.5 }}>
      <CardHeader
        title={<Typography variant="h5">Subsetting Settings</Typography>}
        subheader={<Typography variant="subtitle1">Control how subsets of the data can be presented</Typography>}
        avatar={
          <Avatar>
            <VerticalSplitIcon />
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
            <Button fullWidth onClick={addSubsetOperation} endIcon={<AddCircleOutlineIcon />}>
              Add a new subsetter
            </Button>
            {atomsSubsetOperations.map((atomPredicateFormula, subsetterIndex) => {
              return (
                <SingleSubsetter
                  key={`${atomPredicateFormula}`}
                  atomPredicateFormula={atomPredicateFormula}
                  subsetterIndex={subsetterIndex}
                />
              );
            })}
          </Stack>
        </CardContent>
      </Collapse>
    </Card>
  );
}

export default SubsettingSettings;
