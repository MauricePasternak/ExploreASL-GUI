import { useMemo } from "react";
import { Button, Collapse, Grid, NumberInput, Stack } from "@mantine/core";
import { IconFilter } from "@tabler/icons-react";

import { useVisualizationStore } from "../../stores/visualizationStore";

export default function FilterPanel() {
  const chartData = useVisualizationStore((s) => s.chartData);
  const domainFilters = useVisualizationStore((s) => s.domainFilters);
  const setDomainFilters = useVisualizationStore((s) => s.setDomainFilters);
  const filtersExpanded = useVisualizationStore((s) => s.filtersExpanded);
  const setFiltersExpanded = useVisualizationStore((s) => s.setFiltersExpanded);

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    const xValues = chartData.map((p) => p.x).filter((v): v is number => typeof v === "number");
    const yValues = chartData.map((p) => p.y);
    return {
      xMin: xValues.length > 0 ? Math.min(...xValues) : undefined,
      xMax: xValues.length > 0 ? Math.max(...xValues) : undefined,
      yMin: yValues.length > 0 ? Math.min(...yValues) : undefined,
      yMax: yValues.length > 0 ? Math.max(...yValues) : undefined,
    };
  }, [chartData]);

  return (
    <Stack data-testid="filter-panel" gap="xs">
      <Button
        variant="subtle"
        size="compact-sm"
        leftSection={<IconFilter size={14} />}
        onClick={() => setFiltersExpanded(!filtersExpanded)}
        data-testid="filter-toggle-btn"
      >
        Filters
      </Button>
      <Collapse expanded={filtersExpanded}>
        <Grid>
          <Grid.Col span={6}>
            <NumberInput
              label="X min"
              placeholder={xMin !== undefined ? String(xMin) : "\u2014"}
              value={domainFilters.xMin ?? undefined}
              onChange={(val) => setDomainFilters({ xMin: typeof val === "number" ? val : null })}
              size="xs"
              data-testid="filter-x-min"
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <NumberInput
              label="X max"
              placeholder={xMax !== undefined ? String(xMax) : "\u2014"}
              value={domainFilters.xMax ?? undefined}
              onChange={(val) => setDomainFilters({ xMax: typeof val === "number" ? val : null })}
              size="xs"
              data-testid="filter-x-max"
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <NumberInput
              label="Y min"
              placeholder={yMin !== undefined ? String(yMin) : "\u2014"}
              value={domainFilters.yMin ?? undefined}
              onChange={(val) => setDomainFilters({ yMin: typeof val === "number" ? val : null })}
              size="xs"
              data-testid="filter-y-min"
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <NumberInput
              label="Y max"
              placeholder={yMax !== undefined ? String(yMax) : "\u2014"}
              value={domainFilters.yMax ?? undefined}
              onChange={(val) => setDomainFilters({ yMax: typeof val === "number" ? val : null })}
              size="xs"
              data-testid="filter-y-max"
            />
          </Grid.Col>
        </Grid>
      </Collapse>
    </Stack>
  );
}
