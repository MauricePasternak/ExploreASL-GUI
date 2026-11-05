import { useEffect, useState } from "react";
import { Button, Group, Loader, Text } from "@mantine/core";
import { IconCheck, IconFolder, IconFolderOpen, IconTrash, IconX } from "@tabler/icons-react";
import { exists } from "@tauri-apps/plugin-fs";

import { useGlobalStore } from "../../stores/globalStore";
import { logAction } from "../../lib/debug";

interface RecentEntry {
  path: string;
  projectId?: string;
  name?: string;
  stale: boolean;
}

interface RecentProjectsListProps {
  onOpen: (path: string) => void;
  disabled?: boolean;
  "data-testid"?: string;
}

function getProjectLabel(path: string) {
  const segments = path.split(/[/\\]/).filter(Boolean);
  const fileName = segments[segments.length - 1] ?? path;

  if (fileName === "project.easl" && segments.length >= 2) {
    return segments[segments.length - 2] ?? fileName.replace(".easl", "");
  }

  return fileName.replace(".easl", "");
}

export default function RecentProjectsList({
  onOpen,
  disabled = false,
  "data-testid": dataTestId,
}: RecentProjectsListProps) {
  const recentProjects = useGlobalStore((state) => state.settings.recentProjects);
  const removeRecentProject = useGlobalStore((state) => state.removeRecentProject);
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadEntries() {
      setLoading(true);

      const nextEntries = await Promise.all(
        recentProjects.map(async (project) => ({
          ...project,
          stale: !(await exists(project.path)),
        })),
      );

      if (active) {
        setEntries(nextEntries);
        setLoading(false);
      }
    }

    void loadEntries();

    return () => {
      active = false;
    };
  }, [recentProjects]);

  if (loading) {
    return <Loader size="sm" data-testid={dataTestId || "recent-projects-loader"} />;
  }

  if (entries.length === 0) {
    return (
      <Text c="dimmed" data-testid={dataTestId || "recent-projects-empty"}>
        No recent projects. Create or open one to get started.
      </Text>
    );
  }

  function handleOpen(entry: RecentEntry) {
    if (disabled) {
      return;
    }

    if (!entry.stale) {
      logAction("recent_open", { path: entry.path });
      onOpen(entry.path);
      return;
    }

    const shouldRemove = window.confirm(
      `Project ${entry.name ?? getProjectLabel(entry.path)} was moved or deleted. Remove from recent projects?`,
    );

    if (shouldRemove) {
      logAction("recent_remove_stale", { path: entry.path });
      removeRecentProject(entry.path);
    }
  }

  return (
    <div role="list" data-testid={dataTestId || "recent-projects-list"}>
      {entries.map((entry) => {
        const rowId = entry.path.replace(/[^a-z0-9]/gi, "-");
        const label = entry.name ?? getProjectLabel(entry.path);
        const StatusIcon = entry.stale ? IconX : IconCheck;
        return (
          <div
            role="listitem"
            className="recent-project-row"
            key={entry.path}
            data-testid={`recent-project-row-${rowId}`}
          >
            <div className="recent-project-details" data-testid={`recent-project-details-${rowId}`}>
              <IconFolder
                size={21}
                aria-hidden="true"
                data-testid={`recent-project-folder-icon-${rowId}`}
              />
              <span className="recent-project-info" data-testid={`recent-project-info-${rowId}`}>
                <Text
                  component="span"
                  fw={600}
                  size="sm"
                  data-testid={`recent-project-name-text-${rowId}`}
                >
                  {label}
                </Text>
                <Text
                  component="span"
                  className="recent-project-path"
                  id={`recent-project-path-${rowId}`}
                  data-testid={`recent-project-path-${rowId}`}
                >
                  {entry.path}
                </Text>
                <Text
                  component="span"
                  size="xs"
                  c={entry.stale ? "red" : undefined}
                  className="recent-project-status"
                  id={`recent-project-status-${rowId}`}
                  data-testid={`recent-project-status-${entry.stale ? "stale" : "available"}-${rowId}`}
                >
                  <StatusIcon
                    size={14}
                    aria-hidden="true"
                    color={
                      entry.stale
                        ? "light-dark(var(--mantine-color-red-8), var(--mantine-color-red-4))"
                        : "light-dark(var(--mantine-color-green-8), var(--mantine-color-green-4))"
                    }
                    style={{ flexShrink: 0 }}
                    data-testid={`recent-project-status-icon-${rowId}`}
                  />
                  {entry.stale ? "Moved or deleted" : "Available"}
                </Text>
              </span>
            </div>
            <Group
              gap="xs"
              className="recent-project-actions"
              data-testid={`recent-project-actions-${rowId}`}
            >
              <Button
                size="xs"
                h={44}
                variant="filled"
                color="blue.8"
                leftSection={
                  <IconFolderOpen
                    size={16}
                    aria-hidden="true"
                    data-testid={`recent-open-icon-${rowId}`}
                  />
                }
                disabled={disabled}
                aria-label={`Open ${label}`}
                aria-describedby={`recent-project-path-${rowId} recent-project-status-${rowId}`}
                onClick={() => handleOpen(entry)}
                data-testid={`recent-open-btn-${rowId}`}
              >
                Open
              </Button>
              <Button
                size="xs"
                h={44}
                variant="filled"
                color="red.8"
                leftSection={
                  <IconTrash
                    size={16}
                    aria-hidden="true"
                    data-testid={`recent-remove-icon-${rowId}`}
                  />
                }
                aria-label={`Remove ${label} from recent projects`}
                title="Remove from this list only. Project files stay unchanged."
                onClick={() => {
                  logAction("recent_remove", { path: entry.path });
                  removeRecentProject(entry.path);
                }}
                data-testid={`recent-remove-btn-${rowId}`}
              >
                Remove from list
              </Button>
            </Group>
          </div>
        );
      })}
    </div>
  );
}
