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
}

function getProjectLabel(path: string) {
  const segments = path.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? path;

  if (fileName === "project.easl" && segments.length >= 2) {
    return segments[segments.length - 2] ?? fileName.replace(".easl", "");
  }

  return fileName.replace(".easl", "");
}

export default function RecentProjectsList({ onOpen }: RecentProjectsListProps) {
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
    return <Loader size="sm" />;
  }

  if (entries.length === 0) {
    return <Text c="dimmed">No recent projects. Create or open one to get started.</Text>;
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
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Project</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {entries.map((entry) => (
          <Table.Tr key={entry.path}>
            <Table.Td>
              <Group gap="xs">
                <IconFolder size={16} />
                <Text>{getProjectLabel(entry.path)}</Text>
              </Group>
            </Table.Td>
            <Table.Td>
              {entry.stale ? (
                <Alert color="red" variant="light" title="Moved or deleted">
                  This project file is no longer available.
                </Alert>
              ) : (
                <Text c="green">Available</Text>
              )}
            </Table.Td>
            <Table.Td>
              <Group gap="xs">
                <Button size="xs" variant="light" onClick={() => handleOpen(entry)} data-testid={`recent-open-btn-${entry.path.replace(/[^a-z0-9]/gi, "-")}`}>
                  Open
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => { logAction("recent_remove", { path: entry.path }); removeRecentProject(entry.path); }}
                  data-testid={`recent-remove-btn-${entry.path.replace(/[^a-z0-9]/gi, "-")}`}
                >
                  Remove
                </Button>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
