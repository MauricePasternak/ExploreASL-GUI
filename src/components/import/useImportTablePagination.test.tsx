import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useImportTablePagination } from "./useImportTablePagination";

afterEach(cleanup);

it("slices records, clamps shrinking results, and resets page when size changes", () => {
  const rows = Array.from({ length: 31 }, (_, index) => index);
  const { result, rerender } = renderHook(
    ({ records }) => useImportTablePagination(records, "labels"),
    { initialProps: { records: rows } },
  );
  act(() => result.current.setPage(4));
  expect(result.current.tableProps.records).toEqual([30]);
  rerender({ records: rows.slice(0, 11) });
  expect(result.current.tableProps.page).toBe(2);
  expect(result.current.tableProps.records).toEqual([10]);
  act(() => result.current.tableProps.onRecordsPerPageChange(25));
  expect(result.current.tableProps.page).toBe(1);
  expect(result.current.tableProps.records).toEqual(rows.slice(0, 11));
  rerender({ records: [] });
  expect(result.current.tableProps.page).toBe(1);
});
