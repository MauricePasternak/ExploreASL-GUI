import { Table, Text } from "@mantine/core";
import { formatKappa, KAPPA_GUIDANCE, type KappaResult } from "../../lib/interRaterAgreement";

export interface AgreementSummaryProps {
  reviewerCount: number;
  overall: KappaResult;
  disagreementCount: number;
  perGroup: ReadonlyArray<{ label: string; result: KappaResult }>;
}

function formatAgreementRate(result: KappaResult): string {
  const agreed = Math.round(result.agreementRate * result.n);
  return `${Math.round(result.agreementRate * 100)}% (${agreed}/${result.n})`;
}

export default function AgreementSummary({
  reviewerCount,
  overall,
  disagreementCount,
  perGroup,
}: AgreementSummaryProps) {
  return (
    <div data-testid="agreement-summary">
      <Table withTableBorder withColumnBorders striped data-testid="agreement-overall-table">
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>Number of Reviewers</Table.Td>
            <Table.Td>{reviewerCount}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Overall Initial Agreement Rate</Table.Td>
            <Table.Td>{formatAgreementRate(overall)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Kappa Value</Table.Td>
            <Table.Td>
              {overall.kappa === null
                ? "N/A"
                : `κ = ${formatKappa(overall.kappa, overall.ci95Lower, overall.ci95Upper)}`}
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Number of Subjects</Table.Td>
            <Table.Td>{overall.n}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Subjects Requiring Resolution</Table.Td>
            <Table.Td>{disagreementCount}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Text size="sm" c="dimmed" mt="sm" data-testid="kappa-guidance">
        {KAPPA_GUIDANCE}
      </Text>
      <Text fw={600} mt="md">
        Per-Group Agreement
      </Text>
      <Table withTableBorder withColumnBorders striped data-testid="agreement-per-group-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Group</Table.Th>
            <Table.Th>n</Table.Th>
            <Table.Th>Initial Agreement Rate</Table.Th>
            <Table.Th>Kappa Value</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {perGroup.map(({ label, result }) => (
            <Table.Tr key={label}>
              <Table.Td>{label}</Table.Td>
              <Table.Td>{result.n}</Table.Td>
              <Table.Td>{formatAgreementRate(result)}</Table.Td>
              <Table.Td>{formatKappa(result.kappa, result.ci95Lower, result.ci95Upper)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
