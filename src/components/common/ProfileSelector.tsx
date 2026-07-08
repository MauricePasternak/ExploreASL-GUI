import { Alert, Badge, Group, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMemo } from "react";

import type { ExecutionProfile } from "../../schemas/executionProfile";
import { useGlobalStore } from "../../stores/globalStore";

interface ProfileSelectorProps {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  minWidth?: number | string;
}

function formatProfileLabel(profile: ExecutionProfile, valid: boolean): string {
  const version =
    profile.type === "matlab" && profile.exploreAslVersion
      ? ` · v${profile.exploreAslVersion}`
      : "";
  const status = valid ? "" : " (invalid)";
  return `${profile.label}${version}${status}`;
}

export default function ProfileSelector({
  value,
  onChange,
  disabled = false,
  minWidth,
}: ProfileSelectorProps) {
  const executionProfiles = useGlobalStore((state) => state.settings.executionProfiles);
  const profileValidationState = useGlobalStore((state) => state.profileValidationState);
  const validateProfile = useGlobalStore((state) => state.validateProfile);
  const getProfileById = useGlobalStore((state) => state.getProfileById);

  const selectedProfile = value ? getProfileById(value) : undefined;
  const selectedValidation = value ? profileValidationState[value] : undefined;
  const selectedValid = selectedValidation?.valid === true;

  const options = useMemo(
    () =>
      executionProfiles.map((profile) => {
        const valid = profileValidationState[profile.id]?.valid === true;
        return {
          value: profile.id,
          label: formatProfileLabel(profile, valid),
        };
      }),
    [executionProfiles, profileValidationState],
  );

  if (executionProfiles.length === 0) {
    return (
      <Stack gap={4} data-testid="profile-selector-empty" style={{ minWidth }}>
        <Text size="sm" fw={500}>
          Execution profile
        </Text>
        <Text size="sm" c="dimmed">
          No profiles configured. Open Settings to add a MATLAB execution profile.
        </Text>
      </Stack>
    );
  }

  async function handleChange(nextId: string | null) {
    if (!nextId) return;
    onChange(nextId);

    const profile = getProfileById(nextId);
    if (!profile) return;

    await validateProfile(profile);
    const validation = useGlobalStore.getState().profileValidationState[nextId];
    if (validation && !validation.valid) {
      notifications.show({
        color: "orange",
        title: "Execution profile is invalid",
        message: `Profile "${profile.label}" failed validation: ${validation.errors.join("; ")}`,
      });
    }
  }

  return (
    <Stack gap={4} data-testid="profile-selector-container" style={{ minWidth }}>
      <Select
        label="Execution profile"
        placeholder="Select execution profile"
        data={options}
        value={value || null}
        onChange={(nextId) => void handleChange(nextId)}
        disabled={disabled}
        nothingFoundMessage="No profiles found"
        data-testid="profile-selector"
        data-profile-valid={selectedValid ? "true" : "false"}
        w="100%"
        style={{ maxWidth: 360, minWidth }}
        renderOption={({ option }) => {
          const profile = getProfileById(option.value);
          if (!profile) return <span>{option.label}</span>;
          const valid = profileValidationState[profile.id]?.valid === true;
          return (
            <Group gap="xs" wrap="nowrap" data-testid={`profile-selector-option-${profile.id}`}>
              <Text size="sm">{profile.label}</Text>
              <Badge size="xs" variant="light">
                MATLAB
              </Badge>
              {profile.type === "matlab" && profile.exploreAslVersion ? (
                <Text size="xs" c="dimmed" data-testid="profile-selector-matlab-version">
                  v{profile.exploreAslVersion}
                </Text>
              ) : null}
              {valid ? (
                <Text size="xs" c="teal" data-testid="profile-selector-valid">
                  valid
                </Text>
              ) : (
                <Text size="xs" c="orange" data-testid="profile-selector-invalid">
                  invalid
                </Text>
              )}
            </Group>
          );
        }}
      />

      {value && !selectedProfile ? (
        <Text size="sm" c="orange" data-testid="profile-selector-not-found">
          (Profile not found)
        </Text>
      ) : null}

      {selectedProfile && selectedValidation && !selectedValidation.valid ? (
        <Alert color="orange" p="xs" data-testid="profile-selector-invalid-warning">
          <Text size="sm">
            Profile &quot;{selectedProfile.label}&quot; is invalid:{" "}
            {selectedValidation.errors.join("; ")}. Fix it in Settings.
          </Text>
        </Alert>
      ) : null}
    </Stack>
  );
}
