import { TestMantineProvider as MantineProvider } from "../../test/render";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import OrderAliasTable from "./SessionRunOrder";

afterEach(cleanup);

describe("OrderAliasTable", () => {
  it("shows portable collision errors for both Run aliases", () => {
    render(
      <MantineProvider env="test">
        <OrderAliasTable
          aliases={[
            { captured: "one", alias: "ASL", index: 1 },
            { captured: "two", alias: "asl", index: 2 },
          ]}
          onAliasesChange={() => {}}
          emptyMessage="empty"
          description="desc"
          emptyTestId="empty"
          tableTestId="run-order-table"
          validationField="runAlias"
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("run-order-table-error-one")).toBeInTheDocument();
    expect(screen.getByTestId("run-order-table-error-two")).toBeInTheDocument();
  });

  it("keeps unsafe aliases until a suggestion is accepted", async () => {
    let aliases = [{ captured: "one", alias: "FOO/BAR", index: 1 }];
    const onAliasesChange = (next: typeof aliases) => {
      aliases = next;
    };
    render(
      <MantineProvider env="test">
        <OrderAliasTable
          aliases={aliases}
          onAliasesChange={onAliasesChange}
          emptyMessage="empty"
          description="desc"
          emptyTestId="empty"
          tableTestId="session-order-table"
          validationField="session"
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("session-order-table-error-one")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("session-order-table-suggestion-one"));
    expect(aliases[0].alias).toBe("FOO-BAR");
  });
});
