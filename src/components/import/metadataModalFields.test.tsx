import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestMantineProvider } from "../../test/render";
import MetadataModal from "./MetadataModal";
import type { MetadataGroupFormValues } from "./metadataModalTypes";

afterEach(cleanup);

function renderMetadata(bidsParams: MetadataGroupFormValues["bidsParams"] = {}) {
  const onSubmit = vi.fn();
  render(
    <TestMantineProvider>
      <MetadataModal
        opened
        title="Metadata"
        initialValues={{
          label: "Defaults",
          bidsParams: {
            ArterialSpinLabelingType: "PCASL",
            PostLabelingDelay: 1.8,
            LabelingDuration: 1.8,
            MRAcquisitionType: "3D",
            MagneticFieldStrength: 3,
            Manufacturer: "Siemens",
            ASLContext: "control,label",
            M0Type: "Separate",
            BackgroundSuppression: false,
            ...bidsParams,
          },
        }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    </TestMantineProvider>,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe("BIDS numeric metadata entry", () => {
  it.each([
    ["GE_product", "0.010536"],
    ["Siemens", "0.0147"],
    ["Philips", "0.010014"],
  ] as const)(
    "preserves %s echo time %s during sequential typing and save",
    async (vendor, text) => {
      const { onSubmit, user } = renderMetadata({ Manufacturer: vendor });
      const input = screen.getByTestId("field-echo-time");

      await user.type(input, "0.");
      expect(input).toHaveValue("0.");
      await user.type(input, text.slice(2));
      expect(input).toHaveValue(text);
      await user.click(screen.getByTestId("modal-save-btn"));

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit.mock.calls[0][0].bidsParams.EchoTime).toBe(Number(text));
    },
  );

  it("preserves GE repetition time across the trailing decimal separator", async () => {
    const { onSubmit, user } = renderMetadata({ Manufacturer: "GE_product" });
    const input = screen.getByTestId("field-repetition-time-prep");

    await user.type(input, "4.");
    expect(input).toHaveValue("4.");
    await user.type(input, "632");
    expect(input).toHaveValue("4.632");
    await user.click(screen.getByTestId("modal-save-btn"));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].bidsParams.RepetitionTimePreparation).toBe(4.632);
  });

  it("omits a cleared optional numeric field", async () => {
    const { onSubmit, user } = renderMetadata({ EchoTime: 0.010536 });
    const input = screen.getByTestId("field-echo-time");

    expect(input).toHaveValue("0.010536");
    await user.clear(input);
    expect(input).toHaveValue("");
    await user.click(screen.getByTestId("modal-save-btn"));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].bidsParams).not.toHaveProperty("EchoTime");
  });

  it("retains explicit integer/two-decimal scales and pair-count minimum", async () => {
    const { onSubmit, user } = renderMetadata();
    const pairs = screen.getByTestId("field-total-acquired-pairs");
    const strength = screen.getByTestId("field-magnetic-field-strength");

    await user.type(pairs, "0");
    await user.tab();
    expect(pairs).toHaveValue("1");
    await user.clear(pairs);
    await user.type(pairs, "30.");
    expect(pairs).toHaveValue("30");
    await user.clear(strength);
    await user.type(strength, "1.567");
    expect(strength).toHaveValue("1.56");
    await user.click(screen.getByTestId("modal-save-btn"));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].bidsParams).toMatchObject({
      TotalAcquiredPairs: 30,
      MagneticFieldStrength: 1.56,
    });
  });

  it("rejects an incomplete numeric draft instead of saving it as missing", async () => {
    const { onSubmit, user } = renderMetadata();
    const input = screen.getByTestId("field-echo-time");

    await user.type(input, "-");
    expect(input).toHaveValue("-");
    await user.click(screen.getByTestId("modal-save-btn"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveValue("-");

    await user.clear(input);
    await user.type(input, "0.0147");
    await user.click(screen.getByTestId("modal-save-btn"));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].bidsParams.EchoTime).toBe(0.0147);
  });
});
