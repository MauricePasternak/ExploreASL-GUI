import { Badge, Button, Card, Code, Group, Select, Stack, Text, Title } from "@mantine/core";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";

import { isTokenizerComplete } from "../../lib/importStepAccess";
import { useImportStore } from "../../stores/importStore";
import { splitBySubDelimiters } from "../../lib/pathUtils";
import { generateFolderHierarchy, generateTokenOrdering } from "../../lib/tokenizerUtils";
import type { TokenTag, PathPattern, TokenAssignment } from "../../schemas/importSchemas";
import { TOKEN_TAGS } from "../../schemas/importSchemas";
import { useGlobalStore } from "../../stores/globalStore";

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
  const pathPatterns = useImportStore((s) => s.pathPatterns);
  const ingestionComplete = useImportStore((s) => s.ingestionComplete);
  const tokenizerConfigs = useImportStore((s) => s.tokenizerConfigs);
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
    <Stack gap="md" data-testid="path-tokenizer">
      <Title order={3}>Path Tokenizer</Title>
      <Text c="dimmed" size="sm">
        Assign semantic tags to each folder level. Click a block to expand sub-blocks if the folder
        contains multiple tokens separated by the configured tokenizer delimiters.
      </Text>

      {pathPatterns.map((pattern) => (
        <PatternCard key={pattern.signature} pattern={pattern} />
      ))}

      <Group
        justify="space-between"
        pos="sticky"
        bottom={40}
        style={{
          zIndex: 2,
          paddingTop: "var(--mantine-spacing-md)",
          paddingBottom: "var(--mantine-spacing-md)",
          backgroundColor: "var(--mantine-color-body)",
          boxShadow: "0 -4px 6px -1px rgba(0, 0, 0, 0.06)",
        }}
        data-testid="tokenizer-nav"
      >
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
    </Stack>
  );
}

function PatternCard({ pattern }: { pattern: PathPattern }) {
  const tokenizerConfigs = useImportStore((s) => s.tokenizerConfigs);
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
          <Badge variant="light" size="sm">
            {pattern.count} path{pattern.count !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline" size="sm">
            depth {pattern.depth}
          </Badge>
          <Text size="xs" c="dimmed" ml="auto">
            {pattern.signature}
          </Text>
        </Group>

        {/* Sample path with clickable blocks */}
        <Card withBorder p="sm">
          <Text size="xs" c="dimmed" mb={4}>
            Sample path:
          </Text>
          <Group gap={4} wrap="wrap">
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
        </Card>

        {/* Live regex preview */}
        <RegexPreview hierarchy={hierarchy} ordering={ordering} />
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
        <Stack gap={2} align="center">
          <Badge
            variant={tagColor ? "filled" : "outline"}
            color={tagColor ?? "gray"}
            size="md"
            style={{ cursor: "pointer" }}
          >
            {blockName}
          </Badge>
          <Select
            data={[IGNORE_OPTION, ...TAG_OPTIONS]}
            value={wholeAssignmentValue}
            onChange={handleWholeAssign}
            size="xs"
            w={100}
            comboboxProps={{ withinPortal: true }}
          />
          {uniqueCount > 0 && (
            <Text size="xs" c="dimmed">
              {uniqueCount} unique
            </Text>
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
                  size="sm"
                >
                  {subBlock}
                </Badge>
                <Select
                  data={[IGNORE_OPTION, ...TAG_OPTIONS]}
                  value={subAssignmentValue}
                  onChange={(v) => handleSubBlockAssign(subIndex, v)}
                  size="xs"
                  w={90}
                  comboboxProps={{ withinPortal: true }}
                />
              </Stack>
            </Group>
          );
        })}
      </Group>
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
