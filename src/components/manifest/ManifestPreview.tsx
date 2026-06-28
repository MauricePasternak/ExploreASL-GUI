import { Box, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingStore } from "../../stores/processingStore";
import { aggregateFailReasons } from "../../lib/manifestQc";
import { renderHtml, renderMarkdown } from "../../lib/manifestExport";
import type { ManifestPayload } from "../../lib/manifestExport";
import type { ManifestVerdict } from "../../schemas/project";
import type { MetadataGroup } from "../../schemas/importSchemas";

function useBuildManifestPayload(): ManifestPayload {
  const project = useProjectStore((s) => s.project);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);

  const mappingState = project?.mappingState as Record<string, unknown> | undefined;
  const metadataGroups: MetadataGroup[] = (mappingState?.metadataGroups as MetadataGroup[]) ?? [];
  const subjectRows: Array<{ id: string; subject: string; session: string; groupId: string }> =
    (mappingState?.subjectRows as Array<{
      id: string;
      subject: string;
      session: string;
      groupId: string;
    }>) ?? [];

  const verdicts: Record<string, ManifestVerdict> =
    (project?.uiState?.manifest?.verdicts as Record<string, ManifestVerdict> | undefined) ?? {};
  const versions = project?.uiState?.manifest?.lastRunVersions ?? {};

  const subjectSessionGroups = new Map<string, string>();
  for (const row of subjectRows) {
    subjectSessionGroups.set(`${row.subject}_${row.session}`, row.groupId);
  }

  const section1Groups: ManifestPayload["metadataGroups"] = [];
  for (const group of metadataGroups) {
    const memberSs = new Set<string>();
    for (const [ss, grpId] of subjectSessionGroups) {
      if (grpId === group.id) memberSs.add(ss);
    }
    const members = availableSubjects.filter((s) => memberSs.has(s.subjectSession));
    const totalRuns = members.reduce((sum, s) => sum + s.aslRuns.length, 0);
    const params: Record<string, string> = {};
    for (const [key, val] of Object.entries(group.bidsParams)) {
      if (val == null || key === "id" || key === "label") continue;
      if (
        key === "LabelingDuration" &&
        (group.bidsParams as Record<string, unknown>).ArterialSpinLabelingType === "PASL"
      )
        continue;
      if (
        key === "BolusCutOffDelayTime" &&
        !(group.bidsParams as Record<string, unknown>).BolusCutOffFlag
      )
        continue;
      params[key] = String(val);
    }
    section1Groups.push({
      label: group.label,
      nSubjects: members.length,
      nRuns: totalRuns,
      params,
    });
  }

  const groupedSs = new Set(subjectRows.map((r) => `${r.subject}_${r.session}`));
  const ungroupedMembers = availableSubjects.filter((s) => !groupedSs.has(s.subjectSession));
  if (ungroupedMembers.length > 0) {
    const totalRuns = ungroupedMembers.reduce((sum, s) => sum + s.aslRuns.length, 0);
    section1Groups.push({
      label: "Ungrouped",
      nSubjects: ungroupedMembers.length,
      nRuns: totalRuns,
      params: {},
    });
  }

  const qcGroups: ManifestPayload["qcGroups"] = [];
  for (const group of metadataGroups) {
    const memberSs = new Set<string>();
    for (const [ss, gid] of subjectSessionGroups) {
      if (gid === group.id) memberSs.add(ss);
    }
    const groupRows: Array<{ verdict: string; reason?: string }> = [];
    for (const s of availableSubjects) {
      if (!memberSs.has(s.subjectSession)) continue;
      const v = verdicts[s.subjectSession];
      if (!v) continue;
      groupRows.push({ verdict: v.status, reason: v.reason });
    }
    if (groupRows.length === 0) continue;

    const passCount = groupRows.filter((r) => r.verdict === "pass").length;
    const failCount = groupRows.filter((r) => r.verdict === "fail").length;
    const reasonCounts = aggregateFailReasons(groupRows);
    const failReasons =
      Object.entries(reasonCounts).length > 0
        ? Object.entries(reasonCounts)
            .map(([r, c]) => `${r}: ${c}`)
            .join(", ")
        : "none";

    qcGroups.push({
      label: group.label,
      passTotal: `${passCount} / ${passCount + failCount}`,
      coverage: "N/A",
      spatialCov: "N/A",
      motion: "N/A",
      motionExclusion: "N/A",
      failReasons,
    });
  }

  const nSubjects = availableSubjects.length;
  const nGroups = metadataGroups.length + (ungroupedMembers.length > 0 ? 1 : 0);
  const pipelineParagraph = `Data were processed with ExploreASL (version ${versions.exploreASL ?? "unknown"}) running in MATLAB ${versions.matlab ?? "unknown"} through the ExploreASL GUI (version ${versions.gui ?? "unknown"}). This manifest covers ${nSubjects} subjects across ${nGroups} groups.`;

  return {
    metadataGroups: section1Groups,
    versions,
    qcGroups,
    pipelineParagraph,
  };
}

export default function ManifestPreview() {
  const payload = useBuildManifestPayload();
  const project = useProjectStore((s) => s.project);
  const verdictCount = Object.keys(project?.uiState?.manifest?.verdicts ?? {}).length;
  const exportDisabled = verdictCount === 0;

  return (
    <Stack data-testid="manifest-preview" gap="lg">
      <Group justify="flex-end" gap="sm">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const { writeTextFile } = await import("@tauri-apps/plugin-fs");
            const path = await save({
              defaultPath: "manifest.md",
              filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (!path) return;
            await writeTextFile(path, renderMarkdown(payload));
          }}
          disabled={exportDisabled}
          data-testid="export-markdown-btn"
        >
          Export Markdown
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const { writeTextFile } = await import("@tauri-apps/plugin-fs");
            const path = await save({
              defaultPath: "manifest.html",
              filters: [{ name: "HTML", extensions: ["html"] }],
            });
            if (!path) return;
            await writeTextFile(path, renderHtml(payload));
          }}
          disabled={exportDisabled}
          data-testid="export-html-btn"
        >
          Export HTML
        </Button>
      </Group>

      {/* Section 1: Study Parameters */}
      <Box data-testid="manifest-section-study-parameters">
        <Title order={3}>Study Parameters</Title>
        {payload.metadataGroups.map((g, i) => (
          <Box key={i} mt="sm">
            <Text fw={600}>{g.label}</Text>
            <Table withTableBorder withColumnBorders striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Parameter</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>N Subjects</Table.Td>
                  <Table.Td>{g.nSubjects}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>N Total Runs</Table.Td>
                  <Table.Td>{g.nRuns}</Table.Td>
                </Table.Tr>
                {Object.entries(g.params).map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>{k}</Table.Td>
                    <Table.Td>{v}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        ))}
      </Box>

      {/* Section 2: Software Manifest */}
      <Box data-testid="manifest-section-software-manifest">
        <Title order={3}>Software Manifest</Title>
        <Table withTableBorder withColumnBorders striped highlightOnHover mt="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Software</Table.Th>
              <Table.Th>Version</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>ExploreASL</Table.Td>
              <Table.Td data-testid="version-exploreasl">
                {payload.versions.exploreASL ?? "unknown"}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>ExploreASL GUI</Table.Td>
              <Table.Td data-testid="version-gui">{payload.versions.gui ?? "unknown"}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>MATLAB</Table.Td>
              <Table.Td data-testid="version-matlab">
                {payload.versions.matlab ?? "unknown"}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Box>

      {/* Section 3: QC Summary */}
      <Box data-testid="manifest-section-qc-summary">
        <Title order={3}>QC Summary</Title>
        {payload.qcGroups.map((g, i) => (
          <Box key={i} mt="sm">
            <Text fw={600}>{g.label}</Text>
            <Table withTableBorder withColumnBorders striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Metric</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>Pass / Total</Table.Td>
                  <Table.Td data-testid={`pass-total-${g.label}`}>{g.passTotal}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Mean ASL Coverage % (SD)</Table.Td>
                  <Table.Td>{g.coverage}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Mean Spatial CoV % (SD)</Table.Td>
                  <Table.Td>{g.spatialCov}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Mean Motion (mm RMS) (SD)</Table.Td>
                  <Table.Td>{g.motion}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Mean Motion Exclusion % (SD)</Table.Td>
                  <Table.Td>{g.motionExclusion}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Fail Reasons</Table.Td>
                  <Table.Td>{g.failReasons}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Box>
        ))}
        {payload.qcGroups.length === 0 && (
          <Text c="dimmed">
            No QC data available. Set verdicts in Step 1 to populate this section.
          </Text>
        )}
      </Box>

      {/* Section 4: Pipeline Summary */}
      <Box data-testid="manifest-section-pipeline-summary">
        <Title order={3}>Pipeline Summary</Title>
        <Text mt="sm">{payload.pipelineParagraph}</Text>
      </Box>
    </Stack>
  );
}
