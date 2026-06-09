import type { DataParState } from "../../schemas/dataPar";

interface SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export default function ASLProcessingSection({ dataPar, onFieldChange }: SectionProps) {
  return (
    <div data-testid="asl-processing-section">
      ASL Processing Section
    </div>
  );
}
