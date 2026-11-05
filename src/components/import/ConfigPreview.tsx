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
    "Maps capture groups to ExploreASL's [Subject, Visit, Session, Scan] ordering. Capture groups are numbered from 1; 0 means not captured. The normalized staging tree uses [1, 2, 3, 4].",
  tokenSessionAliases:
    "Maps GUI Run folders in the staging tree to ExploreASL Session aliases. E.g., ^01$ → ASL_1. GUI Session corresponds to ExploreASL Visit instead.",
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
          <Accordion.Control data-testid="config-sourcestructure-toggle">
            <Text fw={600} component="span">
              sourcestructure.json
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Code block data-testid="config-sourcestructure-json">
                {JSON.stringify(sourcestructure, null, 2)}
              </Code>
              {Object.keys(sourcestructure).map((key) => (
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
                </Stack>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="studypar" data-testid="config-studypar-accordion">
          <Accordion.Control data-testid="config-studypar-toggle">
            <Text fw={600} component="span">
              studyPar.json
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Code block data-testid="config-studypar-json">
              {JSON.stringify(studyPar, null, 2)}
            </Code>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
