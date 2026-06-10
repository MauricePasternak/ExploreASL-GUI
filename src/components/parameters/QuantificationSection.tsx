import type { DataParState } from "../../schemas/dataPar";

interface SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export default function QuantificationSection({ dataPar, onFieldChange }: SectionProps) {
  return (
    <div data-testid="quantification-section">
      Quantification Section
    </div>
  );
}
