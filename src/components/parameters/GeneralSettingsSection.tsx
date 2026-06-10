import type { DataParState } from "../../schemas/dataPar";

interface SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export default function GeneralSettingsSection({ dataPar, onFieldChange }: SectionProps) {
  return (
    <div data-testid="general-settings-section">
      General Settings Section
    </div>
  );
}
