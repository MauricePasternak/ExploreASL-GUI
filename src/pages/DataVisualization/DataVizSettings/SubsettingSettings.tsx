import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import ExpandMore from "../../../components/ExpandMore";
import { atomOfAtomsDataVizSubsetOperations, atomSetAddPredicate } from "../../../stores/DataFrameVisualizationStore";
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
