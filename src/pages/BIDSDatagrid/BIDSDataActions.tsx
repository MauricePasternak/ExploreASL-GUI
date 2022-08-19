import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Paper from "@mui/material/Paper";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { BIDSRow } from "../../common/types/BIDSDatagridTypes";
import { atomAddColumnDialogOpen, atomBIDSDataframe } from "../../stores/BIDSDatagridStore";

function BIDSDataActions() {
  const { api } = window;
  const dataframe = useAtomValue(atomBIDSDataframe);
  const setAddColumnDialogOpen = useSetAtom(atomAddColumnDialogOpen);

  async function handleWriteData() {
    try {
      const data = dataframe.toArray() as BIDSRow[];
      for (const row of data) {
        const { ID, File, ...rest } = row;
        // TODO: Add validation of the BIDS row here
        await api.path.writeJSON(File, rest, { spaces: 1 });
      }
      // TODO: This needs to give user feedback of a successful write
    } catch (error) {
      // TODO: This needs to give user feedback of a failed write
    }
  }

  return (
    <Paper
      elevation={10}
      sx={{
        padding: 1,
        position: "fixed",
        left: 0,
        bottom: 0,
        width: "100%",
        borderRadius: 0,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <ButtonGroup>
        <Button variant="outlined" onClick={handleWriteData} disabled={dataframe.count() === 0}>
          Submit Altered BIDS Values
        </Button>
        <Button variant="outlined" onClick={() => setAddColumnDialogOpen(true)}>
          Add a New BIDS Column
        </Button>
      </ButtonGroup>
    </Paper>
  );
}

export default BIDSDataActions;
