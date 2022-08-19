import { Skeleton } from "@mui/material";
import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import { DataFrame } from "data-forge";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isEmpty as lodashIsEmpty, sortBy as lodashSortBy } from "lodash";
import React, { useEffect } from "react";
import DataGrid, { RowsChangeData } from "react-data-grid";
import { BIDSNames } from "../../common/schemas/BIDSDatagridConfigurationSchemas";
import { BIDSFieldNamesType, BIDSRow } from "../../common/types/BIDSDatagridTypes";
import {
  atomBIDSDataframe,
  atomBIDSStudyRootPath,
  atomDataframeColumns,
  atomRDGColumns,
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
    paddingInline: 0
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
  const [StudyRootPath, setStudyRootPath] = useAtom(atomBIDSStudyRootPath);
  const [dataframe, setDataframe] = useAtom(atomBIDSDataframe);
  const setDataFrameColumns = useSetAtom(atomDataframeColumns);
  const columns = useAtomValue(atomRDGColumns);

  console.log("BIDSDG: StudyRootPath:", StudyRootPath);

  useEffect(() => {
    const parseSingleJSON = async (jsonPath: string, basename: string, jsonIndex: number) => {
      const { error, payload } = await api.path.readJSONSafe(jsonPath);
      if (error) return {};
      const data = Object.entries(payload).reduce(
        (acc, [key, value]) => {
          if (!BIDSNames.includes(key as BIDSFieldNamesType)) return acc;
          acc[key] = value;
          return acc;
        },
        { ID: jsonIndex, Basename: basename, File: jsonPath } as Record<string, unknown>
      );
      // console.log(`BIDSDataGrid: ParsedDataFor ${jsonPath}`, data);
      return data;
    };

    const fetchData = async () => {
      console.log(`BIDSDataGrid: Fetching Data from ${StudyRootPath}`);
      if (!StudyRootPath) {
        dataframe.count() > 0 && setDataframe(new DataFrame());
        return;
      }

      let jsonPaths = await api.path.glob(`${StudyRootPath}/rawdata`, "/**/*asl.json", { onlyFiles: true });
      if (jsonPaths.length === 0) return;
      jsonPaths = lodashSortBy(jsonPaths, "path");
      const jsons = await Promise.all(
        jsonPaths.map(async (jsonPath, jsonIndex) => parseSingleJSON(jsonPath.path, jsonPath.basename, jsonIndex))
      );
      const filteredJSONs = jsons.filter(json => !lodashIsEmpty(json));
      if (filteredJSONs.length === 0) return;
      const newDF = new DataFrame(filteredJSONs);
      setDataframe(newDF);
      setDataFrameColumns(newDF.getColumnNames() as Array<BIDSFieldNamesType | "ID" | "File" | "Basename">);
    };

    fetchData();
  }, [StudyRootPath]);

  const handleRowsChange = (rows: BIDSRow[], data: RowsChangeData<BIDSRow, unknown>) => {
    console.log(`handleRowsChange:`, rows, data);
    setDataframe(new DataFrame(rows));
  };

  const handleSelectedRowsChange = (selectedRows: Set<number>) => {
    console.log(`handleSelectedRowsChange:`, selectedRows);
  };

  return dataframe.count() > 0 ? (
    <RGDContainer
      className="RGDMainContainer"
      height="calc(100vh - 370px)"
      // height={{
      //   xs: "calc(100vh - 550px)",
      //   sm: "calc(100vh - 520px)",
      //   md: "calc(100vh - 380px)",
      //   lg: "calc(100vh - 350px)",
      //   xl: "calc(100vh - 350px)",
      // }}
    >
      <DataGrid
        columns={columns}
        rows={dataframe.toArray()}
        rowHeight={56}
        rowKeyGetter={i => i.ID}
        onRowsChange={handleRowsChange}
        onSelectedRowsChange={handleSelectedRowsChange}
      />
    </RGDContainer>
  ) : (
    <Skeleton
      variant="rectangular"
      height="calc(100vh - 400px)"
      // sx={{
      //   height: {
      //     xs: "calc(100vh - 550px)",
      //     sm: "calc(100vh - 520px)",
      //     md: "calc(100vh - 380px)",
      //     lg: "calc(100vh - 370px)",
      //     xl: "calc(100vh - 370px)",
      //   },
      // }}
    />
  );
}

export default BIDSDG;
