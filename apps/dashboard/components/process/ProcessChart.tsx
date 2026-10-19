import { AreaChart } from "@mantine/charts";
import { Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";

import { formatBytes } from "@/utils/format";
import { HISTORY_OPTIONS, historyCoverage, type HistoryRange, historyTime } from "@/utils/history";
import { trpc } from "@/utils/trpc";

import classes from "./Process.module.css";

interface ProcessChartProps {
  processId: string;
  refetchInterval: number;
  showMetric: boolean;
}

export default function ProcessChart({ processId, refetchInterval }: ProcessChartProps) {
  const [range, setRange] = useState<HistoryRange>("hour");
  const getStats = trpc.history.process.useQuery(
    { processId, range },
    { refetchInterval: Math.max(refetchInterval, range === "hour" ? 30_000 : 60_000) },
  );
  const chartData =
    getStats.data?.points.map((s) => ({
      CPU: s.cpu,
      RAM: s.memory,
      HEAP_USED: s.heapUsed,
      date: historyTime(s.timestamp),
    })) || [];
  const populated = getStats.data?.points.filter((point) => point.sources > 0).length ?? 0;

  return (
    <Stack gap="sm" w="100%" miw={0} className={classes.chart}>
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          Resource history
        </Text>
      </Group>
      <SegmentedControl
        className={classes.range}
        aria-label="Process history range"
        size="xs"
        fullWidth
        data={HISTORY_OPTIONS}
        value={range}
        onChange={(value) => setRange(value as HistoryRange)}
      />
      <Text size="xs" c="dimmed" role="status">
        {getStats.isError
          ? "History could not be loaded."
          : getStats.isPending
            ? "Loading history…"
            : historyCoverage(populated, getStats.data?.maxPoints ?? 0)}{" "}
        Bucket means · UTC{getStats.data ? ` · ${getStats.data.bucketMs / 1000}s buckets` : ""}
      </Text>
      <div className={classes.chartGrid}>
        <AreaChart
          w={{ base: "100%", xs: "100%", sm: "calc(50% - 8px)" }}
          miw={0}
          h="180px"
          aria-label="Historical memory usage chart"
          pt="0.5em"
          pr="xs"
          data={chartData}
          valueFormatter={formatBytes}
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
          connectNulls={false}
          areaChartProps={{ syncId: `history-${processId}` }}
        />
        <AreaChart
          w={{ base: "100%", xs: "100%", sm: "calc(50% - 8px)" }}
          miw={0}
          h="180px"
          aria-label="Historical CPU usage chart"
          pt="0.5em"
          pr="xs"
          data={chartData}
          dataKey="date"
          type="default"
          valueFormatter={(value) => `${value.toFixed(1)}%`}
          series={[{ name: "CPU", color: "indigo.6" }]}
          withLegend
          withGradient
          withDots={false}
          withXAxis={false}
          connectNulls={false}
          areaChartProps={{ syncId: `history-${processId}` }}
        />
      </div>
    </Stack>
  );
}
