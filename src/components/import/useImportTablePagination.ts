import { useState } from "react";

export function useImportTablePagination<T>(records: T[], testId: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(records.length / pageSize)));

  return {
    setPage,
    tableProps: {
      records: records.slice((currentPage - 1) * pageSize, currentPage * pageSize),
      page: currentPage,
      onPageChange: setPage,
      totalRecords: records.length,
      recordsPerPage: pageSize,
      recordsPerPageOptions: [10, 25, 50],
      onRecordsPerPageChange: (size: number) => {
        setPageSize(size);
        setPage(1);
      },
      recordsPerPageLabel: "Rows per page",
      getPaginationControlProps: (control: string) => ({
        "data-testid": `${testId}-page-${control}`,
        "aria-label": `${control} page`,
      }),
      getPaginationItemProps: (number: number) => ({
        "data-testid": `${testId}-page-${number}`,
      }),
    },
  };
}
