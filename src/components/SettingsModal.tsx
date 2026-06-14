import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState, useEffect } from "react";
import { IconSearch, IconTrash } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";

import type { MatlabInstallation } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { logAction } from "../lib/debug";

async function fetchExploreAslVersion(exploreAslPath: string): Promise<string | null> {
  if (exploreAslPath.trim().length === 0) return null;
  try {
    return await invoke<string | null>("detect_exploreasl_version", { exploreAslPath });
  } catch {
    return null;
  }
}

async function detectMatlabVersionForPath(path: string): Promise<string | null> {
  if (path.trim().length === 0) return null;
  try {
    const results = await invoke<MatlabInstallation[]>("which_matlab", {
      customPaths: [path],
    });
    const match = results.find((r) => r.path === path);
    return match?.version || null;
  } catch {
    return null;
  }
}

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

export default function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const settings = useGlobalStore((state) => state.settings);
  const setMatlabInstallations = useGlobalStore((state) => state.setMatlabInstallations);
  const setExploreAslPath = useGlobalStore((state) => state.setExploreAslPath);
  const setExploreAslVersion = useGlobalStore((state) => state.setExploreAslVersion);
  const setTheme = useGlobalStore((state) => state.setTheme);
  const setTokenSubDelimiters = useGlobalStore((state) => state.setTokenSubDelimiters);
  const setPreserveStagingDir = useGlobalStore((state) => state.setPreserveStagingDir);
  const saveSettings = useGlobalStore((state) => state.saveSettings);
  const [newDelimiter, setNewDelimiter] = useState("");
  const [detectingVersions, setDetectingVersions] = useState(false);
  const [detectingPaths, setDetectingPaths] = useState<Record<string, boolean>>({});

  async function checkVersion(id: string, path: string) {
    setDetectingPaths((prev) => ({ ...prev, [id]: true }));
    try {
      const version = await detectMatlabVersionForPath(path);
      updateMatlab(id, { version: version || "" });
    } finally {
      setDetectingPaths((prev) => ({ ...prev, [id]: false }));
    }
  }

  useEffect(() => {
    if (opened) {
      void fetchExploreAslVersion(settings.exploreAslPath).then(setExploreAslVersion);

      // Auto-detect version for any installations that have a path but no version
      settings.matlabInstallations.forEach((inst) => {
        if (inst.path.trim().length > 0 && !inst.version) {
          void checkVersion(inst.id, inst.path);
        }
      });
    }
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleClose() {
    logAction("settings_close");
    const invalidMatlab = await Promise.all(
      settings.matlabInstallations
        .filter((installation) => installation.path.trim().length > 0)
        .map(async (installation) => ({
          installation,
          exists: await exists(installation.path),
        })),
    );

    const missingMatlab = invalidMatlab.find((entry) => !entry.exists);
    if (missingMatlab) {
      notifications.show({
        color: "yellow",
        title: "MATLAB not found",
        message: `MATLAB was not detected at ${missingMatlab.installation.path}.`,
      });
      return;
    }

    // Detect versions for any installations that have a path but no version
    const updatedInstallations = await Promise.all(
      settings.matlabInstallations.map(async (inst) => {
        if (inst.path.trim().length > 0 && !inst.version) {
          setDetectingPaths((prev) => ({ ...prev, [inst.id]: true }));
          try {
            const version = await detectMatlabVersionForPath(inst.path);
            return { ...inst, version: version || "" };
          } finally {
            setDetectingPaths((prev) => ({ ...prev, [inst.id]: false }));
          }
        }
        return inst;
      }),
    );
    setMatlabInstallations(updatedInstallations);

    if (settings.exploreAslPath.trim().length > 0) {
      const exploreAslEntryPoint = `${settings.exploreAslPath}/ExploreASL.m`;
      if (!(await exists(exploreAslEntryPoint))) {
        notifications.show({
          color: "yellow",
          title: "ExploreASL not found",
          message: `ExploreASL was not detected at ${settings.exploreAslPath}.`,
        });
        return;
      }
      const version = await fetchExploreAslVersion(settings.exploreAslPath);
      setExploreAslVersion(version);
    } else {
      setExploreAslVersion(null);
    }

    if (settings.matlabInstallations.length === 0) {
      notifications.show({
        color: "yellow",
        title: "MATLAB not configured",
        message: "No MATLAB installations detected. Processing will not be available until configured.",
      });
    }

    await saveSettings();
    onClose();
  }

  async function detectMatlab() {
    logAction("settings_detect_matlab");
    setDetectingVersions(true);
    try {
      const found = (await invoke("which_matlab")) as MatlabInstallation[];
      if (found.length === 0) {
        notifications.show({
          color: "yellow",
          title: "MATLAB not found",
          message: "No MATLAB installations were detected on this system.",
        });
        return;
      }

      const existingMap = new Map(
        settings.matlabInstallations.map((inst) => [inst.path, inst]),
      );
      const merged = [...settings.matlabInstallations];

      for (const inst of found) {
        const existing = existingMap.get(inst.path);
        if (existing) {
          if (inst.version && inst.version !== existing.version) {
            const idx = merged.findIndex((m) => m.id === existing.id);
            if (idx >= 0) merged[idx] = { ...merged[idx], version: inst.version };
          }
        } else {
          merged.push(inst);
        }
      }

      setMatlabInstallations(merged);
    } finally {
      setDetectingVersions(false);
    }
  }

  function addManualMatlab() {
    logAction("settings_add_manual_matlab");
    setMatlabInstallations([
      ...settings.matlabInstallations,
      {
        id: `manual_${Date.now()}`,
        label: "Custom MATLAB",
        path: "",
        version: "",
      },
    ]);
  }

  function updateMatlab(id: string, updates: Partial<MatlabInstallation>) {
    setMatlabInstallations(
      settings.matlabInstallations.map((installation) =>
        installation.id === id ? { ...installation, ...updates } : installation,
      ),
    );
  }

  function removeMatlab(id: string) {
    logAction("settings_remove_matlab", { id });
    setMatlabInstallations(
      settings.matlabInstallations.filter((installation) => installation.id !== id),
    );
  }

  function addDelimiter() {
    const trimmedDelimiter = newDelimiter.trim();
    if (
      trimmedDelimiter.length !== 1 ||
      settings.tokenSubDelimiters.includes(trimmedDelimiter)
    ) {
      return;
    }

    setTokenSubDelimiters([...settings.tokenSubDelimiters, trimmedDelimiter]);
    setNewDelimiter("");
  }

  function removeDelimiter(delimiter: string) {
    if (delimiter === "_") {
      return;
    }

    setTokenSubDelimiters(
      settings.tokenSubDelimiters.filter((value) => value !== delimiter),
    );
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Settings" size="lg" data-testid="settings-modal">
      <Stack gap="md">
        <div>
          <Text fw={600} mb="xs">
            MATLAB Installations
          </Text>

          <Stack gap="xs">
            {settings.matlabInstallations.map((installation) => (
              <Group key={installation.id} align="flex-start" wrap="nowrap">
                <TextInput
                  placeholder="Label (e.g. MATLAB R2025a)"
                  value={installation.label}
                  onChange={(event) => updateMatlab(installation.id, { label: event.currentTarget.value })}
                  style={{ flex: 1 }}
                />
                <TextInput
                  placeholder="Path to matlab executable"
                  value={installation.path}
                  onChange={(event) => {
                    updateMatlab(installation.id, { path: event.currentTarget.value, version: "" });
                  }}
                  onBlur={async () => {
                    const path = installation.path.trim();
                    if (path.length > 0) {
                      await checkVersion(installation.id, path);
                    }
                  }}
                  style={{ flex: 2 }}
                  data-testid={`matlab-path-${installation.id}`}
                />
                 <Text
                  size="sm"
                  c={installation.version ? "teal" : "dimmed"}
                  style={{ flex: 0.8, alignSelf: "center", whiteSpace: "nowrap" }}
                  data-testid={`matlab-version-${installation.id}`}
                >
                  {detectingPaths[installation.id] ? (
                    <Loader size={12} />
                  ) : (
                    installation.version || "version not detected"
                  )}
                </Text>
                <ActionIcon
                  aria-label={`Remove ${installation.label}`}
                  color="red"
                  variant="subtle"
                  onClick={() => removeMatlab(installation.id)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>

          <Group mt="sm">
            <Button
              variant="light"
              leftSection={detectingVersions ? <Loader size={14} /> : <IconSearch size={16} />}
              onClick={detectMatlab}
              disabled={detectingVersions}
              data-testid="settings-auto-detect-matlab-btn"
            >
              {detectingVersions ? "Detecting..." : "Auto-Detect"}
            </Button>
            <Button variant="subtle" onClick={addManualMatlab} data-testid="settings-add-manual-matlab-btn">
              Add Manually
            </Button>
          </Group>
        </div>

        <TextInput
          label="ExploreASL Path"
          placeholder="/path/to/ExploreASL"
          value={settings.exploreAslPath}
          onChange={(event) => setExploreAslPath(event.currentTarget.value)}
          data-testid="settings-exploreasl-path"
        />
        {settings.exploreAslPath.trim().length > 0 && (
          <Text
            size="sm"
            c={settings.exploreAslVersion ? "teal" : "orange"}
            data-testid="settings-exploreasl-version"
          >
            {settings.exploreAslVersion
              ? `ExploreASL v${settings.exploreAslVersion} detected`
              : "ExploreASL version not detected"}
          </Text>
        )}

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
        </div>

        <div>
          <Text fw={600} mb="xs">
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
            <Button onClick={addDelimiter} data-testid="settings-add-delimiter-btn">Add Delimiter</Button>
          </Group>
        </div>

        <Group justify="flex-end">
          <Button onClick={handleClose} data-testid="settings-save-close-btn">Save & Close</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
