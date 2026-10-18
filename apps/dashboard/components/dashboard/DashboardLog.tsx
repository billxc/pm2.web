import LogBrowser from "../LogBrowser";

interface DashboardLogProps {
  refetchInterval: number;
  processIds: string[];
}

export default function DashboardLog({ refetchInterval, processIds }: DashboardLogProps) {
  return (
    <LogBrowser
      key={processIds.toSorted((left, right) => left.localeCompare(right)).join(",")}
      processIds={processIds}
      refetchInterval={refetchInterval}
    />
  );
}
