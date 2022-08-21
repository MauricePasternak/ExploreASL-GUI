import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Paper from "@mui/material/Paper";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { BIDSRow } from "../../common/types/BIDSDatagridTypes";
import { atomAddColumnDialogOpen, atomBIDSDataframe } from "../../stores/BIDSDatagridStore";
import { atomBIDSDatagridSnackbar } from "../../stores/SnackbarStore";

function BIDSDataActions() {
  const { api } = window;
  const dataframe = useAtomValue(atomBIDSDataframe);
  const setAddColumnDialogOpen = useSetAtom(atomAddColumnDialogOpen);
  const setBIDSDatagridSnackbar = useSetAtom(atomBIDSDatagridSnackbar);

  async function handleWriteSingleRow(row: BIDSRow) {
    const { ID, File, Basename, ...rest } = row;
    try {
      if (!(await api.path.filepathExists(File)))
        return {
          success: false,
          error: `File ending as ${Basename} does not exist in this study`,
        };
      // TODO: Add validation of the BIDS row here

      // We load in the old values and overwrite them with the new ones; this approach keeps the exisitng datagrid as
      // small as possible in order to accomodate larger datasets at the cost of longer export times.
      const origValues = await api.path.readJSON(File);
      const newValues = { ...origValues, ...rest };
      await api.path.writeJSON(File, newValues, { spaces: 1 });
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: `Encountered an error while writing to file ending as ${Basename}: ${error.message}`,
      };
    }
  }

  async function handleWriteData() {
    try {
      const data = dataframe.toArray() as BIDSRow[];
      const results = await Promise.all(data.map(handleWriteSingleRow));
      const successfulResults = results.filter(({ success }) => success);
      const unsuccessfulResults = results.filter(({ success }) => !success);
      if (unsuccessfulResults.length > 0 && successfulResults.length === 0) {
        setBIDSDatagridSnackbar({
          severity: "error",
          message: [
            `Encountered ${unsuccessfulResults.length} error(s) while writing data to BIDS:`,
            " ",
            ...unsuccessfulResults.map(res => res.error),
          ],
        });
      } else if (unsuccessfulResults.length > 0 && successfulResults.length > 0) {
        setBIDSDatagridSnackbar({
          severity: "warning",
          message: [
            `Encountered ${unsuccessfulResults.length} error(s) while writing data to BIDS:`,
            " ",
            ...unsuccessfulResults.map(res => res.error),
            " ",
            `However, the program did successfully write ${successfulResults.length} item(s) to BIDS files in the study.`,
            "If this outcome was anticipated, you can ignore this message.",
          ],
        });
      } else {
        setBIDSDatagridSnackbar({
          severity: "success",
          title: "Data written successfully",
          message: `Successfully applied changes to all ${successfulResults.length} item(s) and wrote them to BIDS files in the study.`,
        });
      }
    } catch (error) {
      setBIDSDatagridSnackbar({
        severity: "error",
        title: "Error while applying changes",
        message: ["An error occurred while applying changes to BIDS files in the study."],
      });
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
