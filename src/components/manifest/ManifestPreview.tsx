import { Accordion, Box, Button, Code, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useManifestStore } from "../../stores/manifestStore";
import { useGlobalStore } from "../../stores/globalStore";
import {
  aggregateFailReasons,
  aggregateMeanSd,
  aggregateMotionBySubject,
  formatMeanSd,
} from "../../lib/manifestQc";
import { getDefaultDataPar } from "../../lib/dataParDefaults";
import { flattenRunDataPar, generateMethodsParagraph } from "../../lib/manifestMethods";
import { renderHtml, renderMarkdown } from "../../lib/manifestExport";
import type { ManifestPayload } from "../../lib/manifestExport";
import type { DataParState } from "../../schemas/dataParSchema";
import type { ManifestVerdict } from "../../schemas/project";
import type { MetadataGroup } from "../../schemas/importSchemas";
import { summarizeAslContext } from "../../lib/bids/sidecar";

const ARRAY_PARAM_UNIQUE_THRESHOLD = 5;

/**
 * Formats an array parameter value for display.
 * If the array has more than ARRAY_PARAM_UNIQUE_THRESHOLD unique values,
 * it is truncated to the first ARRAY_PARAM_UNIQUE_THRESHOLD elements and
 * a summary of the remaining unique values is appended.
 */
function formatArrayParam(arr: unknown[]): string {
  const unique = new Set(arr.map(String));
  if (unique.size <= ARRAY_PARAM_UNIQUE_THRESHOLD) {
    return `[${arr.map(String).join(", ")}]`;
  }
  const shown = arr.slice(0, ARRAY_PARAM_UNIQUE_THRESHOLD).map(String);
  const remaining = unique.size - ARRAY_PARAM_UNIQUE_THRESHOLD;
  return `[${shown.join(", ")}, … (+${remaining} more unique values)]`;
}

function useBuildManifestPayload(): ManifestPayload {
  const project = useProjectStore((s) => s.project);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const qcData = useManifestStore((s) => s.qcData);
  const qcLoaded = useManifestStore((s) => s.qcLoaded);
  const dataPar = useManifestStore((s) => s.dataPar);

  const mappingState = project?.mappingState as Record<string, unknown> | undefined;
  const metadataGroups: MetadataGroup[] = (mappingState?.metadataGroups as MetadataGroup[]) ?? [];
  const subjectRows: Array<{ id: string; subject: string; session: string; groupId: string }> =
    (mappingState?.subjectRows as Array<{
      id: string;
      subject: string;
      session: string;
      groupId: string;
    }>) ?? [];

  const exploreAslGlobalVersion = useGlobalStore((s) => s.settings.exploreAslVersion);
  const verdicts: Record<string, ManifestVerdict> =
    (project?.uiState?.manifest?.verdicts as Record<string, ManifestVerdict> | undefined) ?? {};
  const lastRun = project?.uiState?.processing?.population?.lastRun;
  const versions = {
    exploreASL: lastRun?.exploreASLVersion || exploreAslGlobalVersion || undefined,
    matlab: lastRun?.matlabVersion,
    gui: lastRun?.guiVersion ?? project?.version ?? import.meta.env.VITE_APP_VERSION,
  };

  const subjectSessionGroups = new Map<string, string>();
  for (const row of subjectRows) {
    const cleanSub = row.subject.replace(/^sub-/, "");
    subjectSessionGroups.set(`${cleanSub}_${row.session}`, row.groupId);
  }

  const section1Groups: ManifestPayload["metadataGroups"] = [];
  for (const group of metadataGroups) {
    const memberSs = new Set<string>();
    for (const [ss, grpId] of subjectSessionGroups) {
      if (grpId === group.id) memberSs.add(ss);
    }
    const members = availableSubjects.filter((s) => {
      const cleanSs = s.subjectSession.replace(/^sub-/, "");
      return memberSs.has(cleanSs);
    });
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
      params[key] =
        key === "ASLContext"
          ? summarizeAslContext(val as string | undefined)
          : Array.isArray(val)
            ? formatArrayParam(val as unknown[])
            : String(val);
    }
    section1Groups.push({
      label: group.label,
      nSubjects: members.length,
      nRuns: totalRuns,
      params,
    });
  }

  const groupedSs = new Set(
    subjectRows.map((r) => {
      const cleanSub = r.subject.replace(/^sub-/, "");
      return `${cleanSub}_${r.session}`;
    }),
  );
  const ungroupedMembers = availableSubjects.filter((s) => {
    const cleanSs = s.subjectSession.replace(/^sub-/, "");
    return !groupedSs.has(cleanSs);
  });
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

  // Aggregate metadata groups
  for (const group of metadataGroups) {
    const memberSs = new Set<string>();
    for (const [ss, gid] of subjectSessionGroups) {
      if (gid === group.id) memberSs.add(ss);
    }
    const groupRows: Array<{
      verdict: string;
      reason?: string;
      coverage?: number;
      spatialCov?: number;
      motion?: number[];
      motionExclusionPct?: number;
    }> = [];
    for (const s of availableSubjects) {
      const cleanSs = s.subjectSession.replace(/^sub-/, "");
      if (!memberSs.has(cleanSs)) continue;
      const v = verdicts[s.subjectSession];
      if (!v) continue;

      const isNoInfo = qcLoaded && qcData != null && !(s.subjectSession in qcData);
      if (isNoInfo) continue;

      const qc = qcData?.[s.subjectSession];
      groupRows.push({
        verdict: v.status,
        reason: v.reason,
        coverage: qc?.coverage,
        spatialCov: qc?.spatialCov,
        motion: qc?.motion,
        motionExclusionPct: qc?.motionExclusionPct,
      });
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

    const coverageStats = aggregateMeanSd(groupRows, (r) => r.coverage);
    const spatialCovStats = aggregateMeanSd(groupRows, (r) => r.spatialCov);
    const motionStats = aggregateMeanSd(groupRows, (r) =>
      r.motion ? (aggregateMotionBySubject(r.motion) ?? undefined) : undefined,
    );
    const motionExclusionStats = aggregateMeanSd(groupRows, (r) => r.motionExclusionPct);

    qcGroups.push({
      label: group.label,
      passTotal: `${passCount} / ${passCount + failCount}`,
      coverage: formatMeanSd(coverageStats),
      spatialCov: formatMeanSd(spatialCovStats),
      motion: formatMeanSd(motionStats),
      motionExclusion: formatMeanSd(motionExclusionStats),
      failReasons,
    });
  }

  // Aggregate Ungrouped members
  if (ungroupedMembers.length > 0) {
    const ungroupedSs = new Set(ungroupedMembers.map((m) => m.subjectSession));
    const groupRows: Array<{
      verdict: string;
      reason?: string;
      coverage?: number;
      spatialCov?: number;
      motion?: number[];
      motionExclusionPct?: number;
    }> = [];
    for (const s of availableSubjects) {
      if (!ungroupedSs.has(s.subjectSession)) continue;
      const v = verdicts[s.subjectSession];
      if (!v) continue;

      const isNoInfo = qcLoaded && qcData != null && !(s.subjectSession in qcData);
      if (isNoInfo) continue;

      const qc = qcData?.[s.subjectSession];
      groupRows.push({
        verdict: v.status,
        reason: v.reason,
        coverage: qc?.coverage,
        spatialCov: qc?.spatialCov,
        motion: qc?.motion,
        motionExclusionPct: qc?.motionExclusionPct,
      });
    }
    if (groupRows.length > 0) {
      const passCount = groupRows.filter((r) => r.verdict === "pass").length;
      const failCount = groupRows.filter((r) => r.verdict === "fail").length;
      const reasonCounts = aggregateFailReasons(groupRows);
      const failReasons =
        Object.entries(reasonCounts).length > 0
          ? Object.entries(reasonCounts)
              .map(([r, c]) => `${r}: ${c}`)
              .join(", ")
          : "none";

      const coverageStats = aggregateMeanSd(groupRows, (r) => r.coverage);
      const spatialCovStats = aggregateMeanSd(groupRows, (r) => r.spatialCov);
      const motionStats = aggregateMeanSd(groupRows, (r) =>
        r.motion ? (aggregateMotionBySubject(r.motion) ?? undefined) : undefined,
      );
      const motionExclusionStats = aggregateMeanSd(groupRows, (r) => r.motionExclusionPct);

      qcGroups.push({
        label: "Ungrouped",
        passTotal: `${passCount} / ${passCount + failCount}`,
        coverage: formatMeanSd(coverageStats),
        spatialCov: formatMeanSd(spatialCovStats),
        motion: formatMeanSd(motionStats),
        motionExclusion: formatMeanSd(motionExclusionStats),
        failReasons,
      });
    }
  }

  // Count SubjectSessions included in the manifest (excluding No Info) (Issue 4)
  const includedSubjects = availableSubjects.filter(
    (s) => !(qcLoaded && qcData != null && !(s.subjectSession in qcData)),
  );
  const nSubjects = includedSubjects.length;
  const nGroups = metadataGroups.length + (ungroupedMembers.length > 0 ? 1 : 0);

  const pipelineParagraph = `Data were processed with ExploreASL (version ${versions.exploreASL ?? "unknown"}) running in MATLAB ${versions.matlab ?? "unknown"} through the ExploreASL GUI (version ${versions.gui ?? "unknown"}). This manifest covers ${nSubjects} subjects across ${nGroups} groups.`;

  const fullDataPar: DataParState = {
    ...getDefaultDataPar(),
    ...flattenRunDataPar((dataPar ?? {}) as Record<string, unknown>),
  };
  const { paragraphs: methodsParagraphs, references: methodsReferences } =
    generateMethodsParagraph(fullDataPar);

  return {
    metadataGroups: section1Groups,
    versions,
    qcGroups,
    pipelineParagraph,
    methodsParagraphs,
    methodsReferences,
    dataPar: dataPar ?? {},
  };
}

/**
 * Returns a sanitised copy of the dataPar object suitable for display:
 * - x.dataset.subjectRegexp defaults to "^sub-.*" if absent/empty
 * - x.dataset.ForceInclusionList is omitted (not relevant for reproducibility)
 */
function sanitiseDataPar(dataPar: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(dataPar) as Record<string, unknown>;
  const x = copy["x"] as Record<string, unknown> | undefined;
  if (x) {
    const dataset = x["dataset"] as Record<string, unknown> | undefined;
    if (dataset) {
      dataset["subjectRegexp"] = "^sub-.*";
      delete dataset["ForceInclusionList"];
    }
  }
  return copy;
}

export default function ManifestPreview() {
  const payload = useBuildManifestPayload();
  const project = useProjectStore((s) => s.project);
  const verdictCount = Object.keys(project?.uiState?.manifest?.verdicts ?? {}).length;
  const exportDisabled = verdictCount === 0;

  const sanitisedDataPar = sanitiseDataPar(payload.dataPar as Record<string, unknown>);
  const dataParJson = JSON.stringify(sanitisedDataPar, null, 2);
  const hasDataPar = Object.keys(sanitisedDataPar).length > 0;

  return (
    <Stack data-testid="manifest-preview" gap="lg">
      <Group justify="flex-end" gap="sm">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const { writeTextFile } = await import("@tauri-apps/plugin-fs");
            const projectRoot = project?.projectMeta?.rootPath;
            const defaultPath = projectRoot ? `${projectRoot}/manifest.md` : "manifest.md";
            const path = await save({
              defaultPath,
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
            const projectRoot = project?.projectMeta?.rootPath;
            const defaultPath = projectRoot ? `${projectRoot}/manifest.html` : "manifest.html";
            const path = await save({
              defaultPath,
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

      <Accordion
        multiple
        defaultValue={["study-parameters", "software-manifest", "qc-summary", "pipeline-summary"]}
        variant="separated"
        data-testid="manifest-accordion"
      >
        {/* Section 1: Study Parameters */}
        <Accordion.Item value="study-parameters" data-testid="manifest-section-study-parameters">
          <Accordion.Control>
            <Title order={3}>Study Parameters</Title>
          </Accordion.Control>
          <Accordion.Panel>
            {payload.metadataGroups.map((g, i) => (
              <Box key={i} mt="sm">
                <Text fw={600}>{g.label}</Text>
                <Table
                  withTableBorder
                  withColumnBorders
                  striped
                  highlightOnHover
                  style={{ tableLayout: "fixed", width: "100%" }}
                >
                  <colgroup>
                    <col style={{ width: "33%" }} />
                    <col style={{ width: "67%" }} />
                  </colgroup>
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
          </Accordion.Panel>
        </Accordion.Item>

        {/* Section 2: Software Manifest */}
        <Accordion.Item value="software-manifest" data-testid="manifest-section-software-manifest">
          <Accordion.Control>
            <Title order={3}>Software Manifest</Title>
          </Accordion.Control>
          <Accordion.Panel>
            <Title order={5} mb="xs">
              Versions
            </Title>
            <Table
              withTableBorder
              withColumnBorders
              striped
              highlightOnHover
              style={{ tableLayout: "fixed", width: "100%" }}
            >
              <colgroup>
                <col style={{ width: "33%" }} />
                <col style={{ width: "67%" }} />
              </colgroup>
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

            {hasDataPar && (
              <Box mt="md">
                <Title order={5} mb="xs">
                  ExploreASL Data Parameter Configuration
                </Title>
                <Code block data-testid="datapar-table">
                  {dataParJson}
                </Code>
              </Box>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        {/* Section 3: QC Summary */}
        <Accordion.Item value="qc-summary" data-testid="manifest-section-qc-summary">
          <Accordion.Control>
            <Title order={3}>QC Summary</Title>
          </Accordion.Control>
          <Accordion.Panel>
            {payload.qcGroups.map((g, i) => (
              <Box key={i} mt="sm">
                <Text fw={600}>{g.label}</Text>
                <Table
                  withTableBorder
                  withColumnBorders
                  striped
                  highlightOnHover
                  style={{ tableLayout: "fixed", width: "100%" }}
                >
                  <colgroup>
                    <col style={{ width: "33%" }} />
                    <col style={{ width: "67%" }} />
                  </colgroup>
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
                      <Table.Td data-testid={`${g.label}-coverage`}>{g.coverage}</Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Mean Spatial CoV % (SD)</Table.Td>
                      <Table.Td data-testid={`${g.label}-spatialCov`}>{g.spatialCov}</Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Mean Motion (mm RMS) (SD)</Table.Td>
                      <Table.Td data-testid={`${g.label}-motion`}>{g.motion}</Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Mean Motion Exclusion % (SD)</Table.Td>
                      <Table.Td data-testid={`${g.label}-motionExclusion`}>
                        {g.motionExclusion}
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Fail Reasons</Table.Td>
                      <Table.Td data-testid={`${g.label}-failReasons`}>{g.failReasons}</Table.Td>
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
          </Accordion.Panel>
        </Accordion.Item>

        {/* Section 4: Pipeline Summary */}
        <Accordion.Item value="pipeline-summary" data-testid="manifest-section-pipeline-summary">
          <Accordion.Control>
            <Title order={3}>Pipeline Summary</Title>
          </Accordion.Control>
          <Accordion.Panel>
            <Text mt="sm">{payload.pipelineParagraph}</Text>
            {payload.methodsParagraphs.length > 0 && (
              <Stack mt="md" gap="sm" data-testid="manifest-methods">
                <Title order={5}>Methods</Title>
                {payload.methodsParagraphs.map((paragraph, index) => (
                  <Text key={index}>{paragraph}</Text>
                ))}
              </Stack>
            )}
            {payload.methodsReferences.length > 0 && (
              <Stack mt="md" gap="xs" data-testid="manifest-references">
                <Title order={5}>References</Title>
                {payload.methodsReferences.map((reference, index) => (
                  <Text key={index} size="sm">
                    {reference}
                  </Text>
                ))}
              </Stack>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
