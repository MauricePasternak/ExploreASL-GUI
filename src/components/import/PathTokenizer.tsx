import { Badge, Button, Card, Code, Group, Select, Stack, Text } from "@mantine/core";
import { IconArrowLeft, IconArrowRight, IconChevronRight, IconRoute } from "@tabler/icons-react";
import HeaderCard from "../common/HeaderCard";
import { comboboxTestIds } from "../common/comboboxTestIds";
import ImportStepLayout from "./ImportStepLayout";

import { isTokenizerComplete } from "../../lib/importStepAccess";
import { splitBySubDelimiters } from "../../lib/pathUtils";
import { generateFolderHierarchy, generateTokenOrdering } from "../../lib/tokenizerUtils";
import type { PathPattern, TokenAssignment, TokenTag } from "../../schemas/importSchemas";
import { TOKEN_TAGS } from "../../schemas/importSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { EMPTY_IMPORT_SETTINGS, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";

const TAG_COLORS: Record<TokenTag, string> = {
  Subject: "blue",
  Session: "grape",
  Run: "orange",
  Modality: "teal",
  Ignore: "gray",
};

const TAG_OPTIONS = TOKEN_TAGS.filter((tag) => tag !== "Ignore").map((tag) => ({
  value: tag,
  label: tag,
}));

const IGNORE_OPTION = { value: "—", label: "Ignore" };

/**
 * Step 2: Visual Path Tokenizer
 *
 * For each discovered path pattern, the user assigns semantic tags
 * (Subject, Session, Run, Modality, Ignore) to folder levels and
 * optionally sub-blocks within folder levels.
 *
 * Shows a live preview of the generated folderHierarchy regex
 * and tokenOrdering.
 */
export default function PathTokenizer() {
  const pathPatterns = useProjectStore(
    (s) => s.project?.mappingState.pathPatterns ?? EMPTY_IMPORT_SETTINGS.pathPatterns,
  );
  const ingestionComplete = useProjectStore(
    (s) => s.project?.mappingState.ingestionComplete ?? false,
  );
  const tokenizerConfigs = useProjectStore(
    (s) => s.project?.mappingState.tokenizerConfigs ?? EMPTY_IMPORT_SETTINGS.tokenizerConfigs,
  );
  const setActiveStep = useImportStore((s) => s.setActiveStep);

  function handleBack() {
    setActiveStep(0);
  }

  function handleNext() {
    setActiveStep(2);
  }

  const allConfigured = isTokenizerComplete({
    ingestionComplete,
    pathPatterns,
    tokenizerConfigs,
  });

  return (
    <ImportStepLayout
      testId="path-tokenizer"
      navigation={
        <Group justify="space-between" data-testid="tokenizer-nav">
          <Button
            leftSection={<IconArrowLeft size={16} />}
            variant="light"
            onClick={handleBack}
            data-testid="tokenizer-back-btn"
          >
            Back: Ingest DICOMs
          </Button>
          <Button
            rightSection={<IconArrowRight size={16} />}
            disabled={!allConfigured}
            onClick={handleNext}
            data-testid="tokenizer-next-btn"
          >
            Next: Resolve Aliases
          </Button>
        </Group>
      }
    >
      <HeaderCard
        icon={IconRoute}
        title="Path Tokenizer"
        subtitle="Assign tags to folders or split tokens at the configured separators. Original paths stay unchanged. Session = ExploreASL Visit; Run = ExploreASL Session."
        color="blue"
        dataTestId="path-tokenizer-header"
      />

      {pathPatterns.map((pattern) => (
        <PatternCard key={pattern.signature} pattern={pattern} />
      ))}
      <Text size="sm" c="dimmed" data-testid="tokenizer-defaults">
        Staging always uses Subject/Session/Run/Modality. Uncaptured Session and Run default to 01;
        the default ExploreASL run alias is ASL_1.
      </Text>
    </ImportStepLayout>
  );
}

function PatternCard({ pattern }: { pattern: PathPattern }) {
  const tokenizerConfigs = useProjectStore(
    (s) => s.project?.mappingState.tokenizerConfigs ?? EMPTY_IMPORT_SETTINGS.tokenizerConfigs,
  );
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);
  const assignments = tokenizerConfigs[pattern.signature] ?? [];
  const uniqueNames = pattern.uniqueNames as Record<string, string[]>;

  // Compute live preview
  const hierarchy = generateFolderHierarchy(assignments, pattern, tokenSubDelimiters);
  const ordering = generateTokenOrdering(assignments, hierarchy);

  return (
    <Card withBorder p="md" data-testid={`pattern-card-${pattern.signature}`}>
      <Stack gap="sm">
        <Group gap="xs">
          <Badge variant="light" color="gray" size="sm">
            {pattern.count} path{pattern.count !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline" size="sm">
            depth {pattern.depth}
          </Badge>
        </Group>
        <Code
          block
          className="dicom-import-literal"
          data-testid={`tokenizer-pattern-${pattern.signature}`}
        >
          {pattern.signature}
        </Code>
        <Text size="xs" c="dimmed">
          Source example · separators are literal
        </Text>
        <Code
          block
          className="dicom-import-literal"
          data-testid={`tokenizer-source-${pattern.signature}`}
        >
          {pattern.samplePath}
        </Code>

        {/* Sample path with clickable blocks */}
        <div
          className="dicom-import-path-scroll"
          tabIndex={0}
          role="region"
          aria-label={`Token assignments for ${pattern.signature}`}
          data-testid={`tokenizer-scroll-${pattern.signature}`}
        >
          <Text size="xs" c="dimmed" mb={4}>
            Sample path:
          </Text>
          <Group
            gap={4}
            wrap="nowrap"
            className="dicom-import-token-lane"
            align="flex-start"
            data-testid={`tokenizer-sample-path-${pattern.signature}`}
          >
            {pattern.blocks.map((block, blockIndex) => (
              <BlockAssigner
                key={`${pattern.signature}-${blockIndex}`}
                pattern={pattern}
                blockIndex={blockIndex}
                blockName={block}
                assignments={assignments}
                uniqueCount={uniqueNames[String(blockIndex)]?.length ?? 0}
              />
            ))}
          </Group>
        </div>

        <details data-testid={`tokenizer-config-disclosure-${pattern.signature}`}>
          <Text
            component="summary"
            size="xs"
            c="dimmed"
            mb={4}
            className="tokenizer-config-toggle"
            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
            data-testid={`tokenizer-config-toggle-${pattern.signature}`}
          >
            <IconChevronRight
              size={14}
              aria-hidden="true"
              className="tokenizer-config-chevron"
              style={{ flexShrink: 0 }}
              data-testid="tokenizer-config-chevron"
            />
            Show generated configuration
          </Text>
          <RegexPreview hierarchy={hierarchy} ordering={ordering} />
        </details>
      </Stack>
    </Card>
  );
}

/**
 * Single block or group of sub-blocks at a folder level.
 * Click to expand sub-blocks, or assign the whole level directly.
 */
function BlockAssigner({
  pattern,
  blockIndex,
  blockName,
  assignments,
  uniqueCount,
}: {
  pattern: PathPattern;
  blockIndex: number;
  blockName: string;
  assignments: TokenAssignment[];
  uniqueCount: number;
}) {
  const setTokenAssignment = useImportStore((s) => s.setTokenAssignment);
  const removeTokenAssignment = useImportStore((s) => s.removeTokenAssignment);
  const setTokenizerConfig = useImportStore((s) => s.setTokenizerConfig);
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);

  // Check if this block has sub-block assignments
  const blockAssignments = assignments.filter((a) => a.blockIndex === blockIndex);
  const hasSubBlockAssignments = blockAssignments.some((a) => a.subBlockIndex !== null);

  // Check if there are sub-blocks (delimiters in the name)
  const { subBlocks, delimiters } = splitBySubDelimiters(blockName, tokenSubDelimiters);
  const hasSubBlocks = subBlocks.length > 1;

  // Get the whole-level assignment (if any)
  const wholeAssignment = blockAssignments.find((a) => a.subBlockIndex === null);

  function handleWholeAssign(value: string | null) {
    if (value === null || value === "—") {
      removeTokenAssignment(pattern.signature, blockIndex, null);
    } else {
      setTokenAssignment(pattern.signature, blockIndex, null, value as TokenTag);
    }
  }

  function handleSubBlockAssign(subBlockIndex: number, value: string | null) {
    if (value === null || value === "—") {
      removeTokenAssignment(pattern.signature, blockIndex, subBlockIndex);
    } else {
      setTokenAssignment(pattern.signature, blockIndex, subBlockIndex, value as TokenTag);
    }
  }

  const wholeAssignmentValue =
    wholeAssignment?.tag === "Ignore" ? "—" : (wholeAssignment?.tag ?? "—");
  const tagColor =
    wholeAssignment && wholeAssignment.tag !== "Ignore"
      ? TAG_COLORS[wholeAssignment.tag]
      : undefined;

  if (!hasSubBlocks || (wholeAssignment && !hasSubBlockAssignments)) {
    // Simple: one select for the whole level
    return (
      <Group gap={4}>
        {blockIndex > 0 && (
          <Text size="lg" c="dimmed" fw={300}>
            /
          </Text>
        )}
        <Stack gap={6} align="center" className="dicom-import-token">
          <Badge
            variant={tagColor ? "filled" : "outline"}
            color={tagColor ?? "gray"}
            size="md"
            style={{ cursor: "pointer" }}
          >
            {blockName}
          </Badge>
          <Select
            aria-label={`Tag folder ${blockName}`}
            data={[IGNORE_OPTION, ...TAG_OPTIONS]}
            value={wholeAssignmentValue}
            onChange={handleWholeAssign}
            size="xs"
            w={100}
            comboboxProps={{ withinPortal: true }}
            {...comboboxTestIds(`tokenizer-assign-${pattern.signature}-${blockIndex}`)}
          />
          {uniqueCount > 0 && (
            <Text size="xs" c="dimmed">
              {uniqueCount} unique
            </Text>
          )}
          {hasSubBlocks && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              onClick={() =>
                setTokenizerConfig(
                  pattern.signature,
                  assignments.filter((a) => a.blockIndex !== blockIndex),
                )
              }
              data-testid={`tokenizer-split-${pattern.signature}-${blockIndex}`}
            >
              Split at separators
            </Button>
          )}
        </Stack>
      </Group>
    );
  }

  // Multi-sub-block view
  return (
    <Group gap={4}>
      {blockIndex > 0 && (
        <Text size="lg" c="dimmed" fw={300}>
          /
        </Text>
      )}
      <Stack gap={6} className="dicom-import-token">
        <Group gap={2} wrap="nowrap">
          {subBlocks.map((subBlock, subIndex) => {
            const subAssignment = blockAssignments.find((a) => a.subBlockIndex === subIndex);
            const subColor =
              subAssignment && subAssignment.tag !== "Ignore"
                ? TAG_COLORS[subAssignment.tag]
                : undefined;
            const subAssignmentValue =
              subAssignment?.tag === "Ignore" ? "—" : (subAssignment?.tag ?? "—");

            return (
              <Group key={`${blockIndex}-${subIndex}`} gap={2}>
                {subIndex > 0 && (
                  <Text size="sm" c="dimmed">
                    {delimiters[subIndex - 1]}
                  </Text>
                )}
                <Stack gap={2} align="center">
                  <Badge
                    variant={subColor ? "filled" : "outline"}
                    color={subColor ?? "gray"}
                    size="md"
                  >
                    {subBlock}
                  </Badge>
                  <Select
                    aria-label={`Tag token ${subBlock} in ${blockName}`}
                    data={[IGNORE_OPTION, ...TAG_OPTIONS]}
                    value={subAssignmentValue}
                    onChange={(v) => handleSubBlockAssign(subIndex, v)}
                    size="xs"
                    w={90}
                    comboboxProps={{ withinPortal: true }}
                    {...comboboxTestIds(
                      `tokenizer-assign-${pattern.signature}-${blockIndex}-${subIndex}`,
                    )}
                  />
                </Stack>
              </Group>
            );
          })}
        </Group>
        <Button
          variant="subtle"
          color="gray"
          size="compact-xs"
          onClick={() =>
            setTokenizerConfig(pattern.signature, [
              ...assignments.filter((a) => a.blockIndex !== blockIndex),
              { blockIndex, subBlockIndex: null, tag: "Ignore" },
            ])
          }
          data-testid={`tokenizer-whole-${pattern.signature}-${blockIndex}`}
        >
          Use whole folder
        </Button>
      </Stack>
    </Group>
  );
}

/**
 * Live preview of the generated folderHierarchy and tokenOrdering.
 */
function RegexPreview({
  hierarchy,
  ordering,
}: {
  hierarchy: string[];
  ordering: [number, number, number, number];
}) {
  const orderingLabels = ["Subject", "Session (Visit)", "Run (Session)", "Modality (Scan)"];

  return (
    <Card withBorder p="xs" data-testid="tokenizer-regex-preview">
      <Text size="xs" fw={500} mb={4}>
        Generated Configuration
      </Text>
      <Text size="xs" c="dimmed" mb={2}>
        folderHierarchy:
      </Text>
      <Code block style={{ fontSize: 11 }}>
        {JSON.stringify(hierarchy, null, 2)}
      </Code>
      <Text size="xs" c="dimmed" mt={8} mb={2}>
        tokenOrdering: [
        {orderingLabels.map((label, i) => (
          <span key={label}>
            {i > 0 && ", "}
            <Text
              component="span"
              size="xs"
              fw={ordering[i] > 0 ? 600 : 400}
              c={ordering[i] > 0 ? undefined : "dimmed"}
            >
              {label}={ordering[i]}
            </Text>
          </span>
        ))}
        ]
      </Text>
    </Card>
  );
}
