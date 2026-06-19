import { Accordion, Code, Stack, Text, Title } from "@mantine/core";

import type { SourcestructureJson, StudyParJson } from "../../schemas/importSchemas";

interface ConfigPreviewProps {
  sourcestructure: SourcestructureJson;
  studyPar: StudyParJson;
}

const FIELD_ANNOTATIONS: Record<string, string> = {
  folderHierarchy:
    "Each regex captures one token from the normalized staging tree (Subject/Session/Run/Modality). Since the staging tree uses clean extracted tokens as folder names, every level matches with ^(.*)$.",
  tokenOrdering:
    "Maps capture groups to ExploreASL's [Subject, Visit, Session, Scan] ordering. Values are 0-based indices into folderHierarchy capture groups; -1 means the token is not extracted from the path (default used instead).",
  tokenSessionAliases:
    "Maps session folder names in the staging tree to ExploreASL visit names. E.g., ^01$ → ASL_1.",
  tokenVisitAliases:
    "Simple 1-to-1 mapping of visit-level folder names (no regex anchors). Required for backwards compatibility with ExploreASL v1.11.0.",
  tokenScanAliases:
    "Maps modality folder names in the staging tree to ExploreASL scan types. E.g., ^ASL4D$ → ASL4D.",
  bMatchDirectories:
    "When true, ExploreASL descends into subdirectories (e.g., DICOM/) to find files rather than expecting files directly in the modality folder.",
};

export default function ConfigPreview({ sourcestructure, studyPar }: ConfigPreviewProps) {
  return (
    <Stack gap="md" data-testid="config-preview">
      <Title order={4}>ExploreASL Configuration</Title>
      <Text c="dimmed" size="sm">
        These config files describe the normalized staging tree. Raw DICOM paths are first organized
        into Subject/Session/Run/Modality, then ExploreASL reads them using these regex rules.
      </Text>

      <Accordion variant="separated">
        <Accordion.Item value="sourcestructure" data-testid="config-sourcestructure-accordion">
          <Accordion.Control>
            <Text fw={600} component="span">
              sourcestructure.json
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {Object.entries(sourcestructure).map(([key, value]) => (
                <Stack key={key} gap={0}>
                  <Text size="sm" fw={500} c="blue">
                    {key}
                    {FIELD_ANNOTATIONS[key] && (
                      <Text size="xs" c="dimmed" component="span">
                        {" "}
                        — {FIELD_ANNOTATIONS[key]}
                      </Text>
                    )}
                  </Text>
                  <Code block>{JSON.stringify(value, null, 2)}</Code>
                </Stack>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="studypar" data-testid="config-studypar-accordion">
          <Accordion.Control>
            <Text fw={600} component="span">
              studyPar.json
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Code block>{JSON.stringify(studyPar, null, 2)}</Code>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
