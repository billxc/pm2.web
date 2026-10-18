import LogBrowser from "../LogBrowser";

interface ProcessLogProps {
  processId: string;
  refetchInterval: number;
}

export default function ProcessLog({ processId, refetchInterval }: ProcessLogProps) {
  return <LogBrowser key={processId} processId={processId} refetchInterval={refetchInterval} />;
}
