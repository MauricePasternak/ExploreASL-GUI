import WarningIcon from "@mui/icons-material/Warning";
import { Typography } from "@mui/material";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { memo, useState } from "react";
import { atomBIDSColumnNames, atomBIDSRemoveColumnDialogOpen, atomSetBIDSRemoveColumn, } from "../../../stores/BIDSDataGridStore";
import { isBIDSNonMiscField } from "../BIDSColumnDefs";
export const BIDSRemoveColumnDialog = memo(() => {
    // Atomic State
    const [open, setOpen] = useAtom(atomBIDSRemoveColumnDialogOpen);
    const currentColumnNames = useAtomValue(atomBIDSColumnNames);
    const removeBIDSColumn = useSetAtom(atomSetBIDSRemoveColumn);
    // Local State
    const [selectedFields, setSelectedFields] = useState([]);
    const [userUnderstandsRisk, setUserUnderstandsRisk] = useState(false);
    const handleSelectedFieldChange = (event) => {
        if (typeof event.target.value === "string") {
            console.log("🚀 ~ file: BIDSRemoveColumnDialog.tsx:32 ~ handleSelectedFieldChange ~ event.target.value", event.target.value);
            setSelectedFields([]);
        }
        else {
            setSelectedFields(event.target.value);
        }
    };
    const handleRemoveColumn = () => {
        removeBIDSColumn(selectedFields);
        setOpen(false);
        setSelectedFields([]);
        setUserUnderstandsRisk(false);
    };
    const handleCloseDialog = () => {
        setOpen(false);
        selectedFields.length > 0 && setSelectedFields([]);
        setUserUnderstandsRisk(false);
    };
    const renderChoices = () => {
        const choices = currentColumnNames.map((name) => {
            if (isBIDSNonMiscField(name)) {
                return (React.createElement(MenuItem, { key: name, value: name }, name));
            }
        });
        return choices;
    };
    return (React.createElement(Dialog, { open: open, maxWidth: "md" },
        React.createElement(DialogTitle, null, "Remove a BIDS Field"),
        React.createElement(DialogContent, null,
            React.createElement(Stack, { rowGap: 2 },
                React.createElement(DialogContentText, null, "Indicate the BIDS Field that you'd like to have removed from the spreadsheet."),
                React.createElement(Select, { fullWidth: true, multiple: true, value: selectedFields, onChange: handleSelectedFieldChange, MenuProps: {
                        sx: { maxHeight: 300 },
                    } }, renderChoices()),
                React.createElement("div", null,
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 16, marginBottom: 8 } },
                        React.createElement(WarningIcon, { color: "warning" }),
                        React.createElement(Typography, { sx: { color: "warning.main", fontWeight: 800 } }, "WARNING:")),
                    React.createElement(DialogContentText, null, "Removal of data carries risk of creating an unprocessable dataset if critical fields are removed. Note that the removal will not be permanent if the spreadsheet is not saved after the removal and can be recovered by requesting a spreadsheet refresh. Saving after a removal, however, will result in permanent changes until the Import Module is re-run or the column is added back in and all cells filled to their previous values.")),
                React.createElement(FormControlLabel, { label: "I confirm that I am aware of how this action will affect my dataset based on the explanation above.", labelPlacement: "end", control: React.createElement(Checkbox, { checked: userUnderstandsRisk, onChange: () => setUserUnderstandsRisk(!userUnderstandsRisk) }) }))),
        React.createElement(DialogActions, null,
            React.createElement(Button, { onClick: handleCloseDialog }, "Cancel"),
            React.createElement(Button, { disabled: selectedFields.length === 0 || !userUnderstandsRisk, onClick: handleRemoveColumn }, "Remove Column from Spreadsheet"))));
});
//# sourceMappingURL=BIDSRemoveColumnDialog.js.map