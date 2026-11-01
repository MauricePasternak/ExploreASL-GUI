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
import { flattenRunDataPar, generateMethodsParagraph } from "../../lib/manifestMethods";
import {
  QC_DENOMINATOR_NOTE,
  renderHtml,
  renderMarkdown,
  sanitiseDataParForExport,
} from "../../lib/manifestExport";
import type { ManifestPayload } from "../../lib/manifestExport";
import { generateVerdictsCsv } from "../../lib/manifestCsvExport";
import { cohensKappa, fleissKappa, type KappaResult } from "../../lib/interRaterAgreement";
import AgreementSummary from "./AgreementSummary";
import PathEntryButton from "../common/PathEntryButton";
import type { DataParState } from "../../schemas/dataParSchema";
import type { ManifestVerdict } from "../../schemas/project";
import type { MetadataGroup } from "../../schemas/importSchemas";
import { summarizeAslContext } from "../../lib/bids/sidecar";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

const ARRAY_PARAM_UNIQUE_THRESHOLD = 5;
type NestedVerdicts = Record<string, Record<string, ManifestVerdict>>;
type Reviewer = { id: string; label: string; createdAt: string };

function normaliseSubjectSession(subjectSession: string): string {
  return subjectSession.replace(/^sub-/, "");
}

function isMultiReviewerMode(
  reviewers: readonly Reviewer[] | undefined,
): reviewers is readonly Reviewer[] {
  return (reviewers?.length ?? 0) >= 2;
}

function resolveFinalVerdict(
  subjectSession: string,
  reviewers: readonly Reviewer[] | undefined,
  verdicts: NestedVerdicts,
  resolvedVerdicts: Record<string, ManifestVerdict> | undefined,
): ManifestVerdict | undefined {
  const resolved = resolvedVerdicts?.[subjectSession];
  if (resolved) return resolved;
  if (!reviewers?.length) return undefined;
  const reviewerVerdicts = verdicts;
  const entries = reviewers.map((reviewer) => reviewerVerdicts[reviewer.id]?.[subjectSession]);
  if (entries.some((verdict) => verdict === undefined)) return undefined;
  return entries.every((verdict) => verdict?.status === entries[0]?.status)
    ? entries[0]
    : undefined;
}

function agreementFor(
  reviewers: readonly Reviewer[],
  verdicts: NestedVerdicts,
  groupLabels: readonly string[],
  groupForSubjectSession: ReadonlyMap<string, string>,
  eligibleSubjectSessions: ReadonlySet<string>,
) {
  const statusesByReviewer = Object.fromEntries(
    reviewers.map((reviewer) => [
      reviewer.id,
      Object.fromEntries(
        Object.entries(verdicts[reviewer.id] ?? {}).map(([subjectSession, verdict]) => [
          subjectSession,
          verdict.status,
        ]),
      ),
    ]),
  ) as Record<string, Record<string, "pass" | "fail">>;
  const calculate = (selected: ReadonlySet<string>): KappaResult => {
    const input = Object.fromEntries(
      reviewers.map((reviewer) => [
        reviewer.id,
        Object.fromEntries(
          Object.entries(statusesByReviewer[reviewer.id]).filter(([subjectSession]) =>
            selected.has(subjectSession),
          ),
        ),
      ]),
    );
    return reviewers.length === 2
      ? cohensKappa(input[reviewers[0].id], input[reviewers[1].id])
      : fleissKappa(input);
  };
  const allSubjects = new Set(Object.values(statusesByReviewer).flatMap(Object.keys));
  const completeSubjects = [...allSubjects].filter((subjectSession) =>
    reviewers.every((reviewer) => statusesByReviewer[reviewer.id][subjectSession] !== undefined),
  );
  const eligibleCompleteSubjects = completeSubjects.filter((subjectSession) =>
    eligibleSubjectSessions.has(subjectSession),
  );
  const completeSet = new Set(eligibleCompleteSubjects);
  const perGroup = groupLabels.map((label) => ({
    label,
    result: calculate(
      new Set(
        eligibleCompleteSubjects.filter(
          (subjectSession) =>
            (groupForSubjectSession.get(normaliseSubjectSession(subjectSession)) ?? "Ungrouped") ===
            label,
        ),
      ),
    ),
  }));
  const disagreementCount = eligibleCompleteSubjects.filter((subjectSession) => {
    const statuses = reviewers.map((reviewer) => statusesByReviewer[reviewer.id][subjectSession]);
    return !statuses.every((status) => status === statuses[0]);
  }).length;
  return { overall: calculate(completeSet), perGroup, disagreementCount };
}

function hasVerdictEntries(
  reviewers: readonly Reviewer[] | undefined,
  verdicts: NestedVerdicts | undefined,
): boolean {
  if (!verdicts) return false;
  return Boolean(
    reviewers?.some((reviewer) => Object.keys(verdicts[reviewer.id] ?? {}).length > 0),
  );
}

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

  const executionProfiles = useGlobalStore((s) => s.settings.executionProfiles);
  const profileValidationState = useGlobalStore((s) => s.profileValidationState);
  const selectedProfileId = project?.uiState?.processing?.config?.selectedProfileId;
  const activeProfile =
    executionProfiles.find((p) => p.id === selectedProfileId) ||
    executionProfiles.find((p) => profileValidationState[p.id]?.valid);
  const exploreAslGlobalVersion = activeProfile?.exploreAslVersion;

  const reviewers = project?.uiState?.manifest?.reviewers as Reviewer[] | undefined;
  const multiReviewers = isMultiReviewerMode(reviewers) ? reviewers : undefined;
  const verdicts = project?.uiState?.manifest?.verdicts ?? {};
  const resolvedVerdicts = project?.uiState?.manifest?.resolvedVerdicts;
  const lastRun = project?.uiState?.processing?.population?.lastRun;
  const versions = {
    exploreASL:
      lastRun?.exploreASLVersion ||
      (exploreAslGlobalVersion
        ? `${exploreAslGlobalVersion} (current profile; not recorded run)`
        : undefined),
    matlab: lastRun?.matlabVersion || undefined,
    gui:
      lastRun?.guiVersion ||
      (import.meta.env.VITE_APP_VERSION
        ? `${import.meta.env.VITE_APP_VERSION} (current GUI build; not recorded run)`
        : undefined),
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
      nParticipants: new Set(members.map((s) => s.subject.replace(/^sub-/, ""))).size,
      nSubjectSessions: members.length,
      nRuns: totalRuns,
      params,
    });
  }

  const groupLabelsById = new Map(metadataGroups.map((group) => [group.id, group.label]));
  const ungroupedMembers = availableSubjects.filter((s) => {
    const cleanSs = s.subjectSession.replace(/^sub-/, "");
    const groupId = subjectSessionGroups.get(cleanSs);
    return !groupId || !groupLabelsById.has(groupId);
  });
  if (ungroupedMembers.length > 0) {
    const totalRuns = ungroupedMembers.reduce((sum, s) => sum + s.aslRuns.length, 0);
    section1Groups.push({
      label: "Ungrouped",
      nParticipants: new Set(ungroupedMembers.map((s) => s.subject.replace(/^sub-/, ""))).size,
      nSubjectSessions: ungroupedMembers.length,
      nRuns: totalRuns,
      params: {},
    });
  }

  const groupForSubjectSession = new Map(
    [...subjectSessionGroups].map(([subjectSession, groupId]) => [
      normaliseSubjectSession(subjectSession),
      groupLabelsById.get(groupId) ?? "Ungrouped",
    ]),
  );
  const agreement = multiReviewers
    ? agreementFor(
        multiReviewers,
        verdicts as NestedVerdicts,
        [
          ...metadataGroups.map((group) => group.label),
          ...(ungroupedMembers.length > 0 ? ["Ungrouped"] : []),
        ],
        groupForSubjectSession,
        new Set(
          availableSubjects
            .filter(
              (subject) => !(qcLoaded && qcData != null && !(subject.subjectSession in qcData)),
            )
            .map((subject) => subject.subjectSession),
        ),
      )
    : undefined;

  const qcGroups: ManifestPayload["qcGroups"] = [];

  const qcBuckets = metadataGroups.map((group) => ({
    label: group.label,
    members: availableSubjects.filter(
      (s) => subjectSessionGroups.get(normaliseSubjectSession(s.subjectSession)) === group.id,
    ),
  }));
  if (ungroupedMembers.length > 0) {
    qcBuckets.push({ label: "Ungrouped", members: ungroupedMembers });
  }
  for (const { label, members } of qcBuckets) {
    const groupRows: Array<{
      verdict: string;
      reason?: string;
      coverage?: number | null;
      spatialCov?: number | null;
      motion?: number[];
      motionExclusionPct?: number | null;
    }> = [];
    for (const s of members) {
      const v = resolveFinalVerdict(s.subjectSession, reviewers, verdicts, resolvedVerdicts);
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
      label,
      passTotal: `${passCount} / ${passCount + failCount}`,
      coverage: formatMeanSd(coverageStats),
      spatialCov: formatMeanSd(spatialCovStats),
      motion: formatMeanSd(motionStats),
      motionExclusion: formatMeanSd(motionExclusionStats),
      failReasons,
      agreementRate: agreement
        ? `${Math.round((agreement.perGroup.find((entry) => entry.label === label)?.result.agreementRate ?? 0) * 100)}%`
        : undefined,
    });
  }

  // Summary excludes No Info; study-parameter group counts retain the full inventory.
  const includedSubjectSessions = availableSubjects.filter(
    (s) => !(qcLoaded && qcData != null && !(s.subjectSession in qcData)),
  );
  const nParticipants = new Set(includedSubjectSessions.map((s) => s.subject.replace(/^sub-/, "")))
    .size;
  const nGroups = metadataGroups.length + (ungroupedMembers.length > 0 ? 1 : 0);

  const pipelineParagraph = `This manifest covers ${nParticipants} unique participant${nParticipants === 1 ? "" : "s"} with ${includedSubjectSessions.length} included subject-session${includedSubjectSessions.length === 1 ? "" : "s"} across ${nGroups} group${nGroups === 1 ? "" : "s"}.`;

  const {
    paragraphs: methodsParagraphs,
    references: methodsReferences,
    disclaimer: methodsDisclaimer,
  } = generateMethodsParagraph(
    dataPar === null ? null : (flattenRunDataPar(dataPar) as DataParState),
    {
      populationRun: lastRun,
      dataSource: project?.projectMeta.dataSource,
      importCompleted: project?.uiState?.import?.completed,
    },
  );

  return {
    metadataGroups: section1Groups,
    versions,
    qcGroups,
    pipelineParagraph,
    methodsDisclaimer,
    methodsParagraphs,
    methodsReferences,
    dataPar: dataPar ?? {},
    agreement:
      agreement && multiReviewers
        ? {
            numberOfReviewers: multiReviewers.length,
            overall: agreement.overall,
            numberOfDisagreements: agreement.disagreementCount,
            perGroup: agreement.perGroup,
          }
        : undefined,
  };
}

export default function ManifestPreview() {
  const payload = useBuildManifestPayload();
  const project = useProjectStore((s) => s.project);
  const reviewers = project?.uiState?.manifest?.reviewers as Reviewer[] | undefined;
  const rawVerdicts = project?.uiState?.manifest?.verdicts;
  const exportDisabled = !hasVerdictEntries(reviewers, rawVerdicts);

  const sanitisedDataPar = sanitiseDataParForExport(payload.dataPar ?? {});
  const dataParJson = JSON.stringify(sanitisedDataPar, null, 2);
  const hasDataPar = Object.keys(sanitisedDataPar).length > 0;

  async function exportToPath(path: string, format: "md" | "html" | "csv") {
    if (exportDisabled) return;
    const content =
      format === "md"
        ? renderMarkdown(payload)
        : format === "html"
          ? renderHtml(payload)
          : generateVerdictsCsv({
              reviewers: reviewers ?? [],
              subjectSessions: useProcessingStore
                .getState()
                .availableSubjects.map((subject) => subject.subjectSession),
              verdicts: rawVerdicts ?? {},
              resolvedVerdicts: project?.uiState?.manifest?.resolvedVerdicts,
              qcMetrics: useManifestStore.getState().qcData ?? undefined,
              agreement: payload.agreement
                ? {
                    numberOfReviewers: payload.agreement.numberOfReviewers,
                    overall: payload.agreement.overall,
                    numberOfDisagreements: payload.agreement.numberOfDisagreements,
                    perGroup: payload.agreement.perGroup.map(({ label, result }) => ({
                      group: label,
                      result,
                    })),
                  }
                : undefined,
            });
    await writeTextFile(path, content);
  }

  return (
    <Stack data-testid="manifest-preview" gap="lg">
      <Group justify="flex-end" gap="sm">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const projectRoot = project?.projectMeta?.rootPath;
            const defaultPath = projectRoot ? `${projectRoot}/manifest.md` : "manifest.md";
            const path = await save({
              defaultPath,
              filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (!path) return;
            await exportToPath(path, "md");
          }}
          disabled={exportDisabled}
          data-testid="export-markdown-btn"
        >
          Export Markdown
        </Button>
        <PathEntryButton
          title="Save Markdown manifest"
          testId="export-markdown-path"
          defaultPath={
            project?.projectMeta.rootPath ? `${project.projectMeta.rootPath}/manifest.md` : ""
          }
          extensions={["md"]}
          save
          disabled={exportDisabled}
          onSelect={(path) => exportToPath(path, "md")}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const projectRoot = project?.projectMeta?.rootPath;
            const defaultPath = projectRoot ? `${projectRoot}/manifest.html` : "manifest.html";
            const path = await save({
              defaultPath,
              filters: [{ name: "HTML", extensions: ["html"] }],
            });
            if (!path) return;
            await exportToPath(path, "html");
          }}
          disabled={exportDisabled}
          data-testid="export-html-btn"
        >
          Export HTML
        </Button>
        <PathEntryButton
          title="Save HTML manifest"
          testId="export-html-path"
          defaultPath={
            project?.projectMeta.rootPath ? `${project.projectMeta.rootPath}/manifest.html` : ""
          }
          extensions={["html"]}
          save
          disabled={exportDisabled}
          onSelect={(path) => exportToPath(path, "html")}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const projectRoot = project?.projectMeta?.rootPath;
            const path = await save({
              defaultPath: projectRoot
                ? `${projectRoot}/manifest_export.csv`
                : "manifest_export.csv",
              filters: [{ name: "CSV", extensions: ["csv"] }],
            });
            if (!path) return;
            await exportToPath(path, "csv");
          }}
          disabled={exportDisabled}
          data-testid="export-csv-btn"
        >
          Export CSV
        </Button>
        <PathEntryButton
          title="Save CSV manifest"
          testId="export-csv-path"
          defaultPath={
            project?.projectMeta.rootPath
              ? `${project.projectMeta.rootPath}/manifest_export.csv`
              : ""
          }
          extensions={["csv"]}
          save
          disabled={exportDisabled}
          onSelect={(path) => exportToPath(path, "csv")}
        />
      </Group>

      <Accordion
        multiple
        defaultValue={[
          "study-parameters",
          "software-manifest",
          "qc-summary",
          ...(payload.agreement ? ["inter-rater-agreement"] : []),
          "pipeline-summary",
        ]}
        variant="separated"
        data-testid="manifest-accordion"
      >
        {/* Section 1: Study Parameters */}
        <Accordion.Item value="study-parameters" data-testid="manifest-section-study-parameters">
          <Accordion.Control data-testid="manifest-study-parameters-toggle">
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
                      <Table.Td>N Participants</Table.Td>
                      <Table.Td data-testid={`participants-${g.label}`}>{g.nParticipants}</Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>N Subject-Sessions</Table.Td>
                      <Table.Td data-testid={`subject-sessions-${g.label}`}>
                        {g.nSubjectSessions}
                      </Table.Td>
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
          <Accordion.Control data-testid="manifest-software-manifest-toggle">
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
                <Text size="sm" data-testid="datapar-evidence-note">
                  Machine-local paths are redacted. Subject selection and inclusion settings are
                  preserved.
                </Text>
                <Code block data-testid="datapar-table">
                  {dataParJson}
                </Code>
              </Box>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        {/* Section 3: QC Summary */}
        <Accordion.Item value="qc-summary" data-testid="manifest-section-qc-summary">
          <Accordion.Control data-testid="manifest-qc-summary-toggle">
            <Title order={3}>QC Summary</Title>
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" data-testid="qc-denominator-note">
              {QC_DENOMINATOR_NOTE}
            </Text>
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
                    {payload.agreement && <col style={{ width: "20%" }} />}
                  </colgroup>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Metric</Table.Th>
                      <Table.Th>Value</Table.Th>
                      {payload.agreement && <Table.Th>Initial Agreement Rate</Table.Th>}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    <Table.Tr>
                      <Table.Td>Pass / Total (subject-sessions)</Table.Td>
                      <Table.Td data-testid={`pass-total-${g.label}`}>{g.passTotal}</Table.Td>
                      {payload.agreement && (
                        <Table.Td data-testid={`agreement-rate-${g.label}`}>
                          {g.agreementRate}
                        </Table.Td>
                      )}
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Mean ASL Coverage % (SD)</Table.Td>
                      <Table.Td data-testid={`${g.label}-coverage`}>{g.coverage}</Table.Td>
                      {payload.agreement && <Table.Td />}
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Mean Spatial CoV % (SD)</Table.Td>
                      <Table.Td data-testid={`${g.label}-spatialCov`}>{g.spatialCov}</Table.Td>
                      {payload.agreement && <Table.Td />}
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Mean Motion (mm RMS) (SD)</Table.Td>
                      <Table.Td data-testid={`${g.label}-motion`}>{g.motion}</Table.Td>
                      {payload.agreement && <Table.Td />}
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Mean Motion Exclusion % (SD)</Table.Td>
                      <Table.Td data-testid={`${g.label}-motionExclusion`}>
                        {g.motionExclusion}
                      </Table.Td>
                      {payload.agreement && <Table.Td />}
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td>Fail Reasons</Table.Td>
                      <Table.Td data-testid={`${g.label}-failReasons`}>{g.failReasons}</Table.Td>
                      {payload.agreement && <Table.Td />}
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

        {payload.agreement && (
          <Accordion.Item
            value="inter-rater-agreement"
            data-testid="manifest-section-inter-rater-agreement"
          >
            <Accordion.Control data-testid="manifest-inter-rater-agreement-toggle">
              <Title order={3}>Inter-Rater Agreement</Title>
            </Accordion.Control>
            <Accordion.Panel>
              <AgreementSummary
                reviewerCount={payload.agreement.numberOfReviewers}
                overall={payload.agreement.overall}
                disagreementCount={payload.agreement.numberOfDisagreements}
                perGroup={payload.agreement.perGroup}
              />
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {/* Section 4: Pipeline Summary */}
        <Accordion.Item value="pipeline-summary" data-testid="manifest-section-pipeline-summary">
          <Accordion.Control data-testid="manifest-pipeline-summary-toggle">
            <Title order={3}>Pipeline Summary</Title>
          </Accordion.Control>
          <Accordion.Panel>
            <Text mt="sm">{payload.pipelineParagraph}</Text>
            {payload.methodsParagraphs.length > 0 && (
              <Stack mt="md" gap="sm" data-testid="manifest-methods">
                <Title order={5}>Methods</Title>
                <Text data-testid="manifest-methods-disclaimer">{payload.methodsDisclaimer}</Text>
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
