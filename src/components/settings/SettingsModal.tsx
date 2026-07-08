import {
  Button,
  Divider,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { IconTrash } from "@tabler/icons-react";

import { useGlobalStore } from "../../stores/globalStore";
import { logAction } from "../../lib/debug";
import ProfileManager from "./ProfileManager";

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

export default function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const settings = useGlobalStore((state) => state.settings);
  const setTheme = useGlobalStore((state) => state.setTheme);
  const setTokenSubDelimiters = useGlobalStore((state) => state.setTokenSubDelimiters);
  const setPreserveStagingDir = useGlobalStore((state) => state.setPreserveStagingDir);
  const saveSettings = useGlobalStore((state) => state.saveSettings);
  const [newDelimiter, setNewDelimiter] = useState("");

  async function handleClose() {
    logAction("settings_close");
    await saveSettings();
    onClose();
  }

  function addDelimiter() {
    const trimmedDelimiter = newDelimiter.trim();
    if (trimmedDelimiter.length !== 1 || settings.tokenSubDelimiters.includes(trimmedDelimiter)) {
      return;
    }

    setTokenSubDelimiters([...settings.tokenSubDelimiters, trimmedDelimiter]);
    setNewDelimiter("");
  }

  function removeDelimiter(delimiter: string) {
    if (delimiter === "_") {
      return;
    }

    setTokenSubDelimiters(settings.tokenSubDelimiters.filter((value) => value !== delimiter));
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Settings"
      size="lg"
      data-testid="settings-modal"
    >
      <Stack gap="md">
        <div>
          <Text fw={600} mb="xs">
            User Interface
          </Text>
          <Select
            label="Theme"
            data={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            value={settings.theme}
            onChange={(value) => {
              if (value === "light" || value === "dark") {
                setTheme(value);
              }
            }}
            data-testid="settings-theme-select"
          />
        </div>

        <Divider />

        <div>
          <Text fw={600} mb="xs">
            Execution Profiles
          </Text>
          <ProfileManager />
        </div>

        <Divider />

        <div>
          <Text fw={600} mb="xs">
            Import
          </Text>
          <Switch
            label="Preserve staging directory"
            description="Keep .easl_staging after a successful import and copy configs to derivatives/ExploreASL_GUI/."
            checked={settings.import.preserveStagingDir}
            onChange={(event) => setPreserveStagingDir(event.currentTarget.checked)}
            data-testid="settings-preserve-staging-dir"
          />

          <Text size="sm" fw={500} mt="md" mb="xs">
            Tokenizer Delimiters
          </Text>
          <Text size="sm" c="dimmed" mb="xs">
            Controls which characters split folder names into sub-blocks during token assignment.
          </Text>

          <Group gap="xs">
            {settings.tokenSubDelimiters.map((delimiter) => (
              <Button
                key={delimiter}
                size="xs"
                variant={delimiter === "_" ? "light" : "default"}
                disabled={delimiter === "_"}
                leftSection={delimiter === "_" ? undefined : <IconTrash size={14} />}
                onClick={() => removeDelimiter(delimiter)}
                data-testid={`settings-delimiter-btn-${delimiter}`}
                aria-label={
                  delimiter === "_"
                    ? `Default delimiter ${delimiter}`
                    : `Remove delimiter ${delimiter}`
                }
              >
                {delimiter}
              </Button>
            ))}
          </Group>

          <Group mt="sm" align="flex-end">
            <TextInput
              label="Add Delimiter"
              placeholder="-"
              value={newDelimiter}
              onChange={(event) => setNewDelimiter(event.currentTarget.value)}
              data-testid="settings-add-delimiter-input"
            />
            <Button onClick={addDelimiter} data-testid="settings-add-delimiter-btn">
              Add Delimiter
            </Button>
          </Group>
        </div>

        <Divider />

        <Group justify="flex-end">
          <Button onClick={handleClose} data-testid="settings-save-close-btn">
            Save & Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
