import { Skeleton } from "@mui/material";
import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import { DataFrame } from "data-forge";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isEmpty as lodashIsEmpty, sortBy as lodashSortBy } from "lodash";
import React, { useEffect, useRef } from "react";
import DataGrid, { CalculatedColumn, RowsChangeData } from "react-data-grid";
import { BIDSFieldNames } from "../../common/schemas/BIDSDatagridConfigurationSchemas";
import { BIDSColumnName, BIDSFieldNamesType, BIDSRow } from "../../common/types/BIDSDatagridTypes";
import {
  atomBIDSDataframe,
  atomBIDSStudyRootPath,
  atomDataframeColumns,
  atomDeleteDataframeCell,
  atomRDGColumnConfigs
} from "../../stores/BIDSDatagridStore";

const RGDContainer = styled(Box)(({ theme }) => ({
  "& .rdg": {
    backgroundColor: theme.palette.mode === "dark" ? "#272727" : "#f5f5f5",
    height: "100%",
    overflow: "auto",
  },
  "& .rdg-cell": {
    backgroundColor: theme.palette.mode === "dark" ? "#121212" : theme.palette.background.default,
    color: theme.palette.text.primary,
    fontSize: theme.typography.htmlFontSize,
    borderRadius: 0,
    paddingInline: 0,
  },
  "& .rdg-header-row > *": {
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.mode === "dark" ? "#333" : "white",
    display: "flex",
    minWidth: "200px",
  },
}));

function BIDSDG() {
  const { api } = window;
  const StudyRootPath = useAtomValue(atomBIDSStudyRootPath);
  const [dataframe, setDataframe] = useAtom(atomBIDSDataframe);
  const setDataFrameColumns = useSetAtom(atomDataframeColumns);
  const deleteDataFrameCell = useSetAtom(atomDeleteDataframeCell);
  const RDGColumnConfig = useAtomValue(atomRDGColumnConfigs);
  const selectedCell = useRef<{ selectedRow: number; selectedColumn: BIDSColumnName }>(null); // Keep track for deleting cells

  /**
   * useEffect for registering IPC events for the BIDS datagrid. At the current time, events include:
   * - `BIDSDataGridDeleteChannel` - for deleting the currently-selected cell when the delete key is pressed.
   */
  useEffect(() => {
    async function RegisterDataGridEvents() {
      await api.invoke("Shortcut:Register", "BIDSDataGridDeleteChannel", "Delete");
    }
    async function UnregisterDataGridEvents() {
      await api.invoke("Shortcut:Unregister", "Delete");
    }

    RegisterDataGridEvents();
    api.on(`BIDSDataGridDeleteChannel:shortcutTriggered`, () => {
      // Sanity check
      if (selectedCell.current === null) return;

      // We need to use the setter atom instead of `setDataframe` due to `dataframe` not being properly updated in this
      // event callback. The setter atom's "get" callback properly fetches to updated dataframe each time.
      const { selectedRow, selectedColumn } = selectedCell.current;
      deleteDataFrameCell({ cellRow: selectedRow, cellCol: selectedColumn });
    });

    // Cleanup
    return () => {
      UnregisterDataGridEvents();
      api.removeAllListeners(`BIDSDataGridDeleteChannel:shortcutTriggered`);
    };
  }, []);

  /**
   * useEffect for loading the dataframe from the BIDS json files whenever StudyRootPath changes.
   */
  useEffect(() => {
    const parseSingleJSON = async (jsonPath: string, basename: string, jsonIndex: number) => {
      const { error, payload } = await api.path.readJSONSafe(jsonPath);
      if (error) return {};
      const data = Object.entries(payload).reduce(
        (acc, [key, value]) => {
          // We filter out keys that are not in the BIDSFieldNames in order to avoid adding extra overhead to processing
          // the datagrid when it comes to enormous studies.
          if (!BIDSFieldNames.includes(key as BIDSFieldNamesType)) return acc;
          acc[key] = value;
          return acc;
        },
        { ID: jsonIndex, Basename: basename, File: jsonPath } as Record<string, unknown>
      );
      // console.log(`BIDSDataGrid: ParsedDataFor ${jsonPath}`, data);
      return data;
    };

    const fetchData = async () => {
      // Sanity check -- must be a valid BIDS study root path
      if (!StudyRootPath || !((await api.path.getFilepathType(StudyRootPath)) === "dir")) return;

      // Get the ASL json files
      let jsonPaths = await api.path.glob(`${StudyRootPath}/rawdata`, "/**/*asl.json", { onlyFiles: true });
      if (jsonPaths.length === 0) return;
      jsonPaths = lodashSortBy(jsonPaths, "path"); // Globing order not guaranteed, so sort by path

      // Load in the JSON contents & parse into a dataframe
      const rawJSONs = await Promise.all(
        jsonPaths.map(async (jsonPath, jsonIndex) => parseSingleJSON(jsonPath.path, jsonPath.basename, jsonIndex))
      );
      const filteredJSONs = rawJSONs.filter(json => !lodashIsEmpty(json));
      if (filteredJSONs.length === 0) return;
      const newDF = new DataFrame(filteredJSONs);

      // Set the dataframe and columns; also re-set the currently-selected cell
      console.log(`BIDSDataGrid: Fetched new DataFrame:`, newDF.toString());
      setDataframe(newDF);
      setDataFrameColumns(newDF.getColumnNames() as BIDSColumnName[]);
      selectedCell.current = null;
    };

    fetchData();
  }, [StudyRootPath]);

  const handleRowsChange = (rows: BIDSRow[], data: RowsChangeData<BIDSRow, unknown>) => {
    // console.log(`handleRowsChange:`, rows, data, dataframe.count());
    setDataframe(new DataFrame(rows));
  };

  const handleRowClick = (row: BIDSRow, column: CalculatedColumn<BIDSRow, unknown>) => {
    if (column.key === "ID" || column.key === "Basename" || column.key === "File") return; // No editing key columns
    // console.log(`handleRowClick:`, row, column);
    selectedCell.current = { selectedRow: row.ID, selectedColumn: column.key as BIDSColumnName };
  };

  return dataframe.count() > 0 ? (
    <RGDContainer className="RGDMainContainer" height="calc(100vh - 370px)">
      <DataGrid
        columns={RDGColumnConfig}
        rows={dataframe.toArray()}
        rowHeight={56}
        rowKeyGetter={i => i.ID}
        onRowsChange={handleRowsChange}
        onRowClick={handleRowClick}
      />
    </RGDContainer>
  ) : (
    <Skeleton variant="rectangular" height="calc(100vh - 400px)" />
  );
}

export default BIDSDG;
