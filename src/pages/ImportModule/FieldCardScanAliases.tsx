import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import FormHelperText from "@mui/material/FormHelperText";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import React from "react";
import { Controller } from "react-hook-form";
import { ImportScanType, ImportSchemaType } from "../../common/types/ImportSchemaTypes";
import { RHFControlAndNameType } from "../../common/types/formTypes";

type FieldCardScanAliasesProps = RHFControlAndNameType<ImportSchemaType, "MappingScanAliases">;

function FieldCardScanAliases({ control, name }: FieldCardScanAliasesProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const hasError = !!fieldState.error;
        const scanAliasMapping: Array<[string, ImportScanType]> = Object.entries(field.value);
        const scanAliases = new Set(Object.values(field.value));
        const scanOptions = [
          {
            label: "T1 Structural Scans",
            value: "T1w",
            disabled: scanAliases.has("T1w"),
          },
          {
            label: "T2 Structural Scans",
            value: "T2w",
            disabled: scanAliases.has("T2w"),
          },
          {
            label: "FLAIR Structural Scans",
            value: "FLAIR",
            disabled: scanAliases.has("FLAIR"),
          },
          {
            label: "ASL Functional Scans",
            value: "ASL4D",
            disabled: scanAliases.has("ASL4D"),
          },
          {
            label: "Proton-Density (M0) Scans",
            value: "M0",
            disabled: scanAliases.has("M0"),
          },
          { label: "Ignore this Folder", value: "Ignore" },
        ] as { label: string; value: ImportScanType; disabled?: boolean }[];

        const handleScanAliasChange = (e: SelectChangeEvent, folderName: string) => {
          const newMapping = { ...field.value, ...{ [folderName]: e.target.value } };
          field.onChange(newMapping);
        };

        const renderAliases = () =>
          scanAliasMapping.map(([folderName, scanAlias], index) => (
            <ListItem
              key={`${index}_${folderName}`}
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(min(100px, 100%), 0.45fr) 130px minmax(min(200px, 100%), 1fr)",
              }}
              divider={index < scanAliasMapping.length - 1}
            >
              <Typography noWrap variant="h6">
                {folderName}
              </Typography>
              <Typography sx={{ mx: "10px" }}>corresponds to</Typography>

              <Select
                variant="outlined"
                fullWidth
                sx={{ minWidth: "150px" }}
                value={scanAlias}
                onChange={e => handleScanAliasChange(e, folderName)}
              >
                {scanOptions.map((option, index) => {
                  return (
                    <MenuItem key={`label_${option.label}_${index}`} {...option}>
                      {option.label}
                    </MenuItem>
                  );
                })}
              </Select>
            </ListItem>
          ));

        return scanAliasMapping.length > 0 ? (
          <Box>
            <Card>
              <CardHeader
                sx={{ bgcolor: hasError ? "error.main" : "primary.main", color: "primary.contrastText" }}
                title="Scan Aliases"
              />
              <CardContent>
                <List>
                  <ListItem sx={{ justifyContent: "space-between" }}>
                    <Typography variant="h6">Folder Name</Typography>
                    <Typography variant="h6">Scan Type</Typography>
                  </ListItem>
                  {renderAliases()}
                </List>
              </CardContent>
            </Card>
            {hasError && <FormHelperText error>{fieldState.error.message}</FormHelperText>}
          </Box>
        ) : (
          <Typography color="error.main" variant="h5">
            Something went wrong. Please try again.
          </Typography>
        );
      }}
    />
  );
}

export default React.memo(FieldCardScanAliases);
