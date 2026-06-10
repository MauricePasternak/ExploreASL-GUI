import type { DataParState } from "../../schemas/dataPar";

interface SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export default function StructuralSection({ dataPar, onFieldChange }: SectionProps) {
  return (
    <div data-testid="structural-section">
      Structural Section
    </div>
  );
}
