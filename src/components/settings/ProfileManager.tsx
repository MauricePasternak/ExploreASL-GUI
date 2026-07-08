import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconFolderSearch,
  IconPencil,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";

import type { MatlabProfile } from "../../schemas/executionProfile";
import { useGlobalStore } from "../../stores/globalStore";

interface MatlabDetectionResult {
  id: string;
  label: string;
  path: string;
  version: string;
}

interface ProfileDraft {
  label: string;
  type: "matlab";
  matlabPath: string;
  exploreAslPath: string;
}

const EMPTY_DRAFT: ProfileDraft = {
  label: "",
  type: "matlab",
  matlabPath: "",
  exploreAslPath: "",
};

async function fetchExploreAslVersion(exploreAslPath: string): Promise<string | null> {
  if (exploreAslPath.trim().length === 0) return null;
  try {
    return await invoke<string | null>("detect_exploreasl_version", { exploreAslPath });
  } catch {
    return null;
  }
}

function summarizePath(path: string): string {
  if (path.trim().length === 0) return "No paths configured";
  return path.length > 48 ? `…${path.slice(-45)}` : path;
}

export default function ProfileManager() {
  const executionProfiles = useGlobalStore((state) => state.settings.executionProfiles);
  const profileValidationState = useGlobalStore((state) => state.profileValidationState);
  const addProfile = useGlobalStore((state) => state.addProfile);
  const updateProfile = useGlobalStore((state) => state.updateProfile);
  const deleteProfile = useGlobalStore((state) => state.deleteProfile);
  const validateProfile = useGlobalStore((state) => state.validateProfile);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [detectingMatlab, setDetectingMatlab] = useState(false);
  const [detectedMatlab, setDetectedMatlab] = useState<MatlabDetectionResult[]>([]);
  const [detectedVersion, setDetectedVersion] = useState<string | null>(null);
  const [detectingVersion, setDetectingVersion] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setSaveErrors([]);
    setDetectedMatlab([]);
    setDetectedVersion(null);
  }, []);

  const startAdd = () => {
    resetForm();
    setEditingId("new");
  };

  const startEdit = (profile: MatlabProfile) => {
    setEditingId(profile.id);
    setDraft({
      label: profile.label,
      type: "matlab",
      matlabPath: profile.matlabPath,
      exploreAslPath: profile.exploreAslPath,
    });
    setSaveErrors([]);
    setDetectedMatlab([]);
    setDetectedVersion(profile.exploreAslVersion ?? null);
  };

  useEffect(() => {
    if (!editingId) return;
    const path = draft.exploreAslPath.trim();
    let cancelled = false;

    if (path.length === 0) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setDetectedVersion(null);
        }
      });
      return;
    }

    Promise.resolve().then(() => {
      if (!cancelled) {
        setDetectingVersion(true);
      }
    });

    void fetchExploreAslVersion(path)
      .then((version) => {
        if (!cancelled) setDetectedVersion(version);
      })
      .finally(() => {
        if (!cancelled) setDetectingVersion(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draft.exploreAslPath, editingId]);

  async function handleDetectMatlab() {
    setDetectingMatlab(true);
    try {
      const found = await invoke<MatlabDetectionResult[]>("which_matlab");
      if (found.length === 0) {
        notifications.show({
          color: "yellow",
          title: "MATLAB not found",
          message: "No MATLAB installations were detected on this system.",
        });
        setDetectedMatlab([]);
        return;
      }
      setDetectedMatlab(found);
    } finally {
      setDetectingMatlab(false);
    }
  }

  async function handleBrowseMatlab() {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Select MATLAB executable",
    });
    if (selected) {
      setDraft((current) => ({ ...current, matlabPath: selected as string }));
    }
  }

  async function handleBrowseExploreAsl() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select ExploreASL directory",
    });
    if (selected) {
      setDraft((current) => ({ ...current, exploreAslPath: selected as string }));
    }
  }

  async function handleSave() {
    if (!editingId) return;

    const label = draft.label.trim();
    const matlabPath = draft.matlabPath.trim();
    const exploreAslPath = draft.exploreAslPath.trim();

    if (!label || !matlabPath || !exploreAslPath) {
      setSaveErrors(["Label, MATLAB path, and ExploreASL path are required."]);
      return;
    }

    const profile: MatlabProfile =
      editingId === "new"
        ? {
            id: crypto.randomUUID(),
            label,
            type: "matlab",
            matlabPath,
            exploreAslPath,
            exploreAslVersion: detectedVersion ?? undefined,
          }
        : {
            id: editingId,
            label,
            type: "matlab",
            matlabPath,
            exploreAslPath,
            exploreAslVersion: detectedVersion ?? undefined,
          };

    setSaving(true);
    setSaveErrors([]);

    try {
      const result = (await invoke("validate_execution_profile", {
        executionProfile: profile,
      })) as {
        id: string;
        valid: boolean;
        errors: string[];
        exploreAslVersion?: string;
      };

      if (!result.valid) {
        setSaveErrors(result.errors);
        return;
      }

      const persistedProfile: MatlabProfile = {
        ...profile,
        exploreAslVersion: result.exploreAslVersion ?? profile.exploreAslVersion,
      };

      if (editingId === "new") {
        await addProfile(persistedProfile);
      } else {
        updateProfile(editingId, persistedProfile);
        await validateProfile(persistedProfile);
      }

      resetForm();
    } finally {
      setSaving(false);
    }
  }

  function handleConfirmDelete() {
    if (!deleteTargetId) return;
    deleteProfile(deleteTargetId);
    if (editingId === deleteTargetId) {
      resetForm();
    }
    setDeleteTargetId(null);
  }

  const deleteTarget = deleteTargetId
    ? executionProfiles.find((profile) => profile.id === deleteTargetId)
    : undefined;
  const isLastProfile = executionProfiles.length === 1 && deleteTargetId !== null;

  return (
    <Stack gap="md" data-testid="profile-manager">
      {executionProfiles.length === 0 && editingId === null ? (
        <Text c="dimmed" size="sm">
          No execution profiles configured. Add a MATLAB profile to run import and processing.
        </Text>
      ) : null}

      {executionProfiles.map((profile) => {
        if (editingId === profile.id) return null;
        const validation = profileValidationState[profile.id];
        const isValid = validation?.valid === true;

        return (
          <Paper key={profile.id} withBorder p="sm" data-testid={`profile-row-${profile.id}`}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Text fw={600}>{profile.label}</Text>
                  <Badge size="sm" variant="light">
                    MATLAB
                  </Badge>
                  {isValid ? (
                    <Tooltip label="Profile validated">
                      <span data-testid={`profile-valid-${profile.id}`}>
                        <IconCircleCheck size={16} color="var(--mantine-color-teal-6)" />
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      label={
                        validation?.errors?.length
                          ? validation.errors.join("; ")
                          : "Profile not validated"
                      }
                    >
                      <span data-testid={`profile-invalid-${profile.id}`}>
                        <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" />
                      </span>
                    </Tooltip>
                  )}
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {profile.type === "matlab"
                    ? `${summarizePath(profile.matlabPath)} · ${summarizePath(profile.exploreAslPath)}`
                    : null}
                </Text>
                {profile.type === "matlab" && profile.exploreAslVersion ? (
                  <Text size="xs" c="teal">
                    ExploreASL v{profile.exploreAslVersion}
                  </Text>
                ) : null}
              </Stack>
              <Group gap="xs">
                <ActionIcon
                  variant="subtle"
                  aria-label={`Edit ${profile.label}`}
                  onClick={() => startEdit(profile as MatlabProfile)}
                  data-testid={`profile-edit-${profile.id}`}
                >
                  <IconPencil size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Delete ${profile.label}`}
                  onClick={() => setDeleteTargetId(profile.id)}
                  data-testid={`profile-delete-${profile.id}`}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </Group>
          </Paper>
        );
      })}

      {editingId ? (
        <Paper withBorder p="md" data-testid="profile-form">
          <Stack gap="sm">
            <Text fw={600}>{editingId === "new" ? "Add Profile" : "Edit Profile"}</Text>

            <TextInput
              label="Label"
              value={draft.label}
              onChange={(event) => {
                const nextValue = event.currentTarget?.value ?? "";
                setDraft((current) => ({ ...current, label: nextValue }));
              }}
              data-testid="profile-form-label"
            />

            <Select
              label="Type"
              data={[{ value: "matlab", label: "MATLAB" }]}
              value={draft.type}
              onChange={(value) => {
                if (value === "matlab") {
                  setDraft((current) => ({ ...current, type: "matlab" }));
                }
              }}
              allowDeselect={false}
              data-testid="profile-form-type"
            />

            <Group align="flex-end" wrap="nowrap">
              <TextInput
                label="MATLAB path"
                value={draft.matlabPath}
                onChange={(event) => {
                  const nextValue = event.currentTarget?.value ?? "";
                  setDraft((current) => ({ ...current, matlabPath: nextValue }));
                }}
                style={{ flex: 1 }}
                data-testid="profile-form-matlab-path"
              />
              <Button
                variant="light"
                leftSection={<IconFolderSearch size={16} />}
                onClick={() => void handleBrowseMatlab()}
                data-testid="profile-browse-matlab-btn"
              >
                Browse
              </Button>
            </Group>

            <Group>
              <Button
                variant="light"
                leftSection={detectingMatlab ? <Loader size={14} /> : <IconSearch size={16} />}
                onClick={() => void handleDetectMatlab()}
                disabled={detectingMatlab}
                data-testid="profile-detect-matlab-btn"
              >
                {detectingMatlab ? "Detecting..." : "Detect MATLAB"}
              </Button>
            </Group>

            {detectedMatlab.length > 0 ? (
              <Stack gap="xs" data-testid="profile-detected-matlab-list">
                {detectedMatlab.map((installation, index) => (
                  <Button
                    key={installation.path}
                    variant="default"
                    justify="flex-start"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        matlabPath: installation.path,
                        label:
                          current.label.trim().length > 0
                            ? current.label
                            : installation.label || "MATLAB",
                      }))
                    }
                    data-testid={`profile-detected-matlab-${index}`}
                  >
                    {installation.version
                      ? `${installation.label} [${installation.version}] — ${installation.path}`
                      : `${installation.label} (${installation.path})`}
                  </Button>
                ))}
              </Stack>
            ) : null}

            <Group align="flex-end" wrap="nowrap">
              <TextInput
                label="ExploreASL path"
                value={draft.exploreAslPath}
                onChange={(event) => {
                  const nextValue = event.currentTarget?.value ?? "";
                  setDraft((current) => ({ ...current, exploreAslPath: nextValue }));
                }}
                style={{ flex: 1 }}
                data-testid="profile-form-exploreasl-path"
              />
              <Button
                variant="light"
                leftSection={<IconFolderSearch size={16} />}
                onClick={() => void handleBrowseExploreAsl()}
                data-testid="profile-browse-exploreasl-btn"
              >
                Browse
              </Button>
            </Group>

            {draft.exploreAslPath.trim().length > 0 ? (
              <Text
                size="sm"
                c={detectedVersion ? "teal" : "orange"}
                data-testid="profile-exploreasl-version"
                data-detected={detectedVersion ? "true" : "false"}
              >
                {detectingVersion ? (
                  <Loader size={12} />
                ) : detectedVersion ? (
                  `ExploreASL v${detectedVersion} detected`
                ) : (
                  "ExploreASL version not detected"
                )}
              </Text>
            ) : null}

            {saveErrors.length > 0 ? (
              <Alert color="red" data-testid="profile-form-errors">
                {saveErrors.map((error) => (
                  <Text key={error} size="sm">
                    {error}
                  </Text>
                ))}
              </Alert>
            ) : null}

            <Group justify="flex-end">
              <Button variant="default" onClick={resetForm} data-testid="profile-form-cancel-btn">
                Cancel
              </Button>
              <Button
                onClick={() => void handleSave()}
                loading={saving}
                data-testid="profile-form-save-btn"
              >
                Save Profile
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : (
        <Button variant="light" onClick={startAdd} data-testid="profile-manager-add-btn">
          Add Profile
        </Button>
      )}

      <Modal
        opened={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title="Delete execution profile?"
        data-testid="profile-delete-dialog"
        transitionProps={{ duration: 0 }}
      >
        <Stack gap="sm">
          <Text size="sm">
            Delete profile &quot;{deleteTarget?.label ?? "Unknown"}&quot;? Projects referencing
            this profile will need a new selection.
          </Text>
          {isLastProfile ? (
            <Alert color="orange" data-testid="profile-delete-last-warning">
              This is your last execution profile. Import, processing, and project actions will be
              blocked until you add another profile.
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteTargetId(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirmDelete} data-testid="profile-delete-confirm-btn">
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
