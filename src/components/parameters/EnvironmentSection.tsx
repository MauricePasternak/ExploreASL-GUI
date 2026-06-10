import type { DataParState } from "../../schemas/dataPar";

interface SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export default function EnvironmentSection({ dataPar, onFieldChange }: SectionProps) {
  return (
    <div data-testid="environment-section">
      Environment Section
    </div>
  );
}
