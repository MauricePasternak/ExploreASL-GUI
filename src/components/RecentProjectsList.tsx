import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Table, Text } from "@mantine/core";
import { IconFolder, IconTrash } from "@tabler/icons-react";
import { exists } from "@tauri-apps/plugin-fs";

import { useGlobalStore } from "../stores/globalStore";
import { logAction } from "../lib/debug";

interface RecentEntry {
  path: string;
  stale: boolean;
}

interface RecentProjectsListProps {
  onOpen: (path: string) => void;
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
        recentProjects.map(async (path) => ({
          path,
          stale: !(await exists(path)),
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
    if (!entry.stale) {
      logAction("recent_open", { path: entry.path });
      onOpen(entry.path);
      return;
    }

    const shouldRemove = window.confirm(
      `Project ${getProjectLabel(entry.path)} was moved or deleted. Remove from recent projects?`,
    );

    if (shouldRemove) {
      logAction("recent_remove_stale", { path: entry.path });
      removeRecentProject(entry.path);
    }
  }

  return (
    <Table striped highlightOnHover data-testid={dataTestId || "recent-projects-table"}>
      <Table.Thead data-testid="recent-projects-thead">
        <Table.Tr data-testid="recent-projects-header-row">
          <Table.Th data-testid="recent-projects-th-project">Project</Table.Th>
          <Table.Th data-testid="recent-projects-th-status">Status</Table.Th>
          <Table.Th data-testid="recent-projects-th-actions">Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody data-testid="recent-projects-tbody">
        {entries.map((entry) => {
          const rowId = entry.path.replace(/[^a-z0-9]/gi, "-");
          return (
            <Table.Tr key={entry.path} data-testid={`recent-project-row-${rowId}`}>
              <Table.Td data-testid={`recent-project-name-cell-${rowId}`}>
                <Group gap="xs" data-testid={`recent-project-name-group-${rowId}`}>
                  <IconFolder size={16} data-testid={`recent-project-folder-icon-${rowId}`} />
                  <Text data-testid={`recent-project-name-text-${rowId}`}>
                    {getProjectLabel(entry.path)}
                  </Text>
                </Group>
              </Table.Td>
              <Table.Td data-testid={`recent-project-status-cell-${rowId}`}>
                {entry.stale ? (
                  <Alert
                    color="red"
                    variant="light"
                    title="Moved or deleted"
                    data-testid={`recent-project-alert-stale-${rowId}`}
                  >
                    This project file is no longer available.
                  </Alert>
                ) : (
                  <Text c="green" data-testid={`recent-project-status-available-${rowId}`}>
                    Available
                  </Text>
                )}
              </Table.Td>
              <Table.Td data-testid={`recent-project-actions-cell-${rowId}`}>
                <Group gap="xs" data-testid={`recent-project-actions-group-${rowId}`}>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => handleOpen(entry)}
                    data-testid={`recent-open-btn-${rowId}`}
                  >
                    Open
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      logAction("recent_remove", { path: entry.path });
                      removeRecentProject(entry.path);
                    }}
                    data-testid={`recent-remove-btn-${rowId}`}
                  >
                    Remove
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
