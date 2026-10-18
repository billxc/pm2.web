import { AreaChart } from "@mantine/charts";
import { Flex } from "@mantine/core";

import { formatBytes } from "@/utils/format";
import { trpc } from "@/utils/trpc";

interface ProcessChartProps {
  processId: string;
  refetchInterval: number;
  showMetric: boolean;
}

export default function ProcessChart({ processId, refetchInterval }: ProcessChartProps) {
  const getStats = trpc.process.getStats.useQuery(
    {
      processId,
      range: "seconds",
    },
    {
      refetchInterval,
    },
  );

  const chartData =
    getStats?.data
      ?.map((s) => ({
        CPU: s.cpu,
        RAM: s.memory,
        HEAP_USED: s.heapUsed,
        date: new Date(s.timestamp).toLocaleTimeString(),
      }))
      ?.reverse() || [];

  return (
    <Flex direction={{ base: "column", sm: "row" }} align="center" justify="space-between">
      <AreaChart
        w={{ base: "100%", sm: "50%" }}
        miw={0}
        h={"150px"}
        aria-label="Memory usage chart"
        pt={"0.5em"}
        pr="xs"
        data={chartData}
        valueFormatter={(value) => formatBytes(value)}
        dataKey="date"
        type="default"
        series={[
          { name: "RAM", color: "yellow" },
          { name: "HEAP_USED", color: "grape", label: "HEAP USED" },
        ]}
        withLegend
        withGradient
        withDots={false}
        withXAxis={false}
        areaChartProps={{ syncId: "stats" }}
      />
      <AreaChart
        w={{ base: "100%", sm: "50%" }}
        miw={0}
        h={"150px"}
        aria-label="CPU usage chart"
        pt={"0.5em"}
        pr="xs"
        data={chartData}
        dataKey="date"
        type="default"
        yAxisProps={{ domain: [0, 100] }}
        series={[{ name: "CPU", color: "indigo.6" }]}
        withLegend
        withGradient
        withDots={false}
        withXAxis={false}
        areaChartProps={{ syncId: "stats" }}
      />
    </Flex>
  );
}
