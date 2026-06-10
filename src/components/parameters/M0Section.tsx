import type { DataParState } from "../../schemas/dataPar";

interface SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export default function M0Section({ dataPar, onFieldChange }: SectionProps) {
  return (
    <div data-testid="m0-section">
      M0 Section
    </div>
  );
}
