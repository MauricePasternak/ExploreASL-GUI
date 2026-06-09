import type { DataParState } from "../../schemas/dataPar";

interface SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export default function AtlasesSection({ dataPar, onFieldChange }: SectionProps) {
  return (
    <div data-testid="atlases-section">
      Atlases Section
    </div>
  );
}
