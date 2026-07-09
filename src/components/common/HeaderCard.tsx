import { Card, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { ComponentType } from "react";
import PageHelpButton from "./PageHelpButton";

interface HeaderCardProps {
  icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  subtitle: React.ReactNode;
  color?: string;
  dataTestId?: string;
  rightSection?: React.ReactNode;
}

export default function HeaderCard({
  icon: Icon,
  title,
  subtitle,
  color = "blue",
  dataTestId,
  rightSection,
}: HeaderCardProps) {
  return (
    <Card withBorder p="md" mb="lg" data-testid={dataTestId}>
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Group gap="sm" align="center">
            <ThemeIcon color={color} size="lg" radius="md" variant="light">
              <Icon size={20} />
            </ThemeIcon>
            <Title order={3} style={{ margin: 0 }}>
              {title}
            </Title>
            <PageHelpButton />
          </Group>
          {rightSection}
        </Group>
        {typeof subtitle === "string" ? (
          <Text c="dimmed" size="sm">
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </Stack>
    </Card>
  );
}
