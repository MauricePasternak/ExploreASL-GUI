import { Button, Popover, Table } from "@mantine/core";
import { aggregateMotionBySubject, type SubjectQcOutputs } from "../../lib/manifestQc";

function formatMetric(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "Unavailable" : `${value}${suffix}`;
}

export default function QcMetricsPopover({
  subjectSession,
  metrics,
  dropdownTestId,
}: {
  subjectSession: string;
  metrics?: SubjectQcOutputs;
  dropdownTestId: string;
}) {
  return (
    <Popover width={240} position="bottom" withArrow shadow="md">
      <Popover.Target>
        <Button
          size="compact-xs"
          variant="subtle"
          aria-label={`View QC metrics for ${subjectSession}`}
          data-testid={`view-qc-metrics-${subjectSession}`}
        >
          QC Metrics
        </Button>
      </Popover.Target>
      <Popover.Dropdown data-testid={dropdownTestId}>
        <Table withTableBorder={false} verticalSpacing="xs">
          <Table.Tbody>
            {(
              [
                ["Coverage", formatMetric(metrics?.coverage, "%")],
                ["SpatialCoV", formatMetric(metrics?.spatialCov)],
                [
                  "Max Motion",
                  formatMetric(
                    metrics ? aggregateMotionBySubject(metrics.motion) : null,
                    " mm RMS",
                  ),
                ],
                ["Motion Exclusion", formatMetric(metrics?.motionExclusionPct, "%")],
              ] as const
            ).map(([label, value]) => (
              <Table.Tr key={label}>
                <Table.Td>{label}</Table.Td>
                <Table.Td>{value}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Popover.Dropdown>
    </Popover>
  );
}
