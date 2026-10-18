import { AreaChart } from "@mantine/charts";
import { Group, Paper, SegmentedControl, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { ISetting } from "@pm2.web/typings";
import { IconActivity, IconClockHour4, IconCpu, IconDeviceSdCard, IconServer } from "@tabler/icons-react";
import ms from "ms";
import { InferGetServerSidePropsType } from "next";
import Head from "next/head";
import { useState } from "react";

import { SelectedProvider, useSelected } from "@/components/context/SelectedProvider";
import DashboardLog from "@/components/dashboard/DashboardLog";
import { Dashboard } from "@/components/layouts/Dashboard";
import { getServerSideHelpers } from "@/server/helpers";
import { formatBytes } from "@/utils/format";
import { HISTORY_OPTIONS, historyCoverage, type HistoryRange, historyTime } from "@/utils/history";
import { trpc } from "@/utils/trpc";

const statChartProps = {
  h: "300px",
  withLegend: true,
  withGradient: true,
  withDots: false,
  withXAxis: true,
  withYAxis: true,
  yAxisProps: { width: 55 },
  areaChartProps: { syncId: "stats" },
  connectNulls: false,
  curveType: "linear" as const,
};

function Home({ settings }: { settings: ISetting }) {
  const { selectedServers, selectedProcesses } = useSelected();
  const [range, setRange] = useState<HistoryRange>("hour");
  const selection = {
    processIds: selectedProcesses.map((p) => p._id),
    serverIds: selectedServers.map((p) => p._id),
  };
  const history = trpc.history.overview.useQuery(
    { ...selection, range },
    { refetchInterval: Math.max(settings.polling.frontend, range === "hour" ? 30_000 : 60_000) },
  );
  // Live summaries do not change with the selected historical window.
  const latest = trpc.history.latest.useQuery(selection, { refetchInterval: settings.polling.frontend });
  const chartData = history.data?.points.map((e) => ({ ...e, date: historyTime(e.timestamp) })) || [];
  const populated =
    history.data?.points.filter((point) => point.processSources > 0 || point.serverSources > 0).length ?? 0;

  const onlineCount = selectedProcesses.filter((p) => p.status == "online").length;

  return (
    <Stack gap="xl" flex={1}>
      <Group justify="space-between" align="center">
        <Title order={2}>System Overview</Title>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <Paper p="xl" radius="md" shadow="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div>
              <Text c="dimmed" tt="uppercase" fw={700} size="xs">
                Total Servers
              </Text>
              <Text fw={900} size="2.5rem">
                {selectedServers.length}
              </Text>
            </div>
            <ThemeIcon color="cyan" variant="light" size={48} radius="md">
              <IconServer size="1.8rem" />
            </ThemeIcon>
          </Group>
        </Paper>

        <Paper p="xl" radius="md" shadow="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div>
              <Text c="dimmed" tt="uppercase" fw={700} size="xs">
                Online Processes
              </Text>
              <Group align="flex-end" gap="xs" wrap="nowrap">
                <Text fw={900} size="2.5rem">
                  {onlineCount}
                </Text>
                <Text c="dimmed" pb="sm">
                  / {selectedProcesses.length}
                </Text>
              </Group>
            </div>
            <ThemeIcon
              color={onlineCount === selectedProcesses.length && onlineCount > 0 ? "teal" : "cyan"}
              variant="light"
              size={48}
              radius="md"
            >
              <IconActivity size="1.8rem" />
            </ThemeIcon>
          </Group>
        </Paper>

        <Paper p="xl" radius="md" shadow="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div>
              <Text c="dimmed" tt="uppercase" fw={700} size="xs">
                Mean Server Uptime (live)
              </Text>
              <Text fw={900} size="2.5rem" style={{ whiteSpace: "nowrap" }}>
                {latest.data?.server?.uptime == null ? "—" : ms(latest.data.server.uptime)}
              </Text>
            </div>
            <ThemeIcon color="violet" variant="light" size={48} radius="md">
              <IconClockHour4 size="1.8rem" />
            </ThemeIcon>
          </Group>
        </Paper>

        <Paper p="xl" radius="md" shadow="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div>
              <Text c="dimmed" tt="uppercase" fw={700} size="xs">
                Mean Process Uptime (live)
              </Text>
              <Text fw={900} size="2.5rem" style={{ whiteSpace: "nowrap" }}>
                {latest.data?.process?.uptime == null ? "—" : ms(latest.data.process.uptime)}
              </Text>
            </div>
            <ThemeIcon color="grape" variant="light" size={48} radius="md">
              <IconActivity size="1.8rem" />
            </ThemeIcon>
          </Group>
        </Paper>
      </SimpleGrid>

      <Stack gap="xs" miw={0}>
        <Group justify="space-between" wrap="wrap">
          <Title order={3}>Resource History</Title>
          <SegmentedControl
            aria-label="Overview history range"
            size="xs"
            w={{ base: "100%", sm: "auto" }}
            data={HISTORY_OPTIONS}
            value={range}
            onChange={(value) => setRange(value as HistoryRange)}
          />
        </Group>
        <Text size="sm" c="dimmed">
          Mean per reporting process / server, not fleet totals. Equal weight per source after averaging within each
          bucket. UTC{history.data ? ` · ${history.data.bucketMs / 1000}s buckets` : ""}. Only authorized monitoring
          sources are included.
        </Text>
        <Text size="xs" c="dimmed" role="status">
          {history.isError
            ? "History could not be loaded."
            : history.isPending
              ? "Loading history…"
              : historyCoverage(populated, history.data?.maxPoints ?? 0)}
          {history.data &&
            ` Process buckets: ${history.data.points.filter((p) => p.processSources > 0).length}/${history.data.maxPoints}; server buckets: ${history.data.points.filter((p) => p.serverSources > 0).length}/${history.data.maxPoints}.`}
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
        <Paper p="xl" shadow="sm" radius="md">
          <Group justify="space-between" mb="lg">
            <Text fw={700} size="lg">
              Mean CPU Usage
            </Text>
            <ThemeIcon color="blue" variant="light" size="lg" radius="xl">
              <IconCpu size="1.2rem" />
            </ThemeIcon>
          </Group>
          <AreaChart
            {...statChartProps}
            data={chartData}
            dataKey="date"
            type="default"
            valueFormatter={(value) => value.toFixed(1) + "%"}
            series={[
              { name: "processCpu", color: "cyan.6", label: "Mean process CPU" },
              { name: "serverCpu", color: "violet.6", label: "Mean server CPU" },
            ]}
          />
        </Paper>

        <Paper p="xl" shadow="sm" radius="md">
          <Group justify="space-between" mb="lg">
            <Text fw={700} size="lg">
              Mean Memory Usage
            </Text>
            <ThemeIcon color="indigo" variant="light" size="lg" radius="xl">
              <IconDeviceSdCard size="1.2rem" />
            </ThemeIcon>
          </Group>
          <AreaChart
            {...statChartProps}
            data={chartData}
            dataKey="date"
            type="default"
            valueFormatter={(value) => formatBytes(value)}
            series={[
              { name: "processRam", color: "teal.6", label: "Mean process RAM" },
              { name: "serverRam", color: "indigo.6", label: "Mean server RAM" },
            ]}
          />
        </Paper>
      </SimpleGrid>

      <Paper p="xl" shadow="sm" radius="md">
        <Text fw={700} size="lg" mb="md">
          Process Activity Logs
        </Text>
        <DashboardLog refetchInterval={settings.polling.frontend} processIds={selectedProcesses.map((p) => p._id)} />
      </Paper>
    </Stack>
  );
}

export default function HomePage({}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const dashboardQuery = trpc.server.getDashBoardData.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const data = dashboardQuery.data!;

  return dashboardQuery.status === "success" ? (
    <>
      <Head>
        <title>pm2.web</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" href="/logo.png" />
      </Head>
      <SelectedProvider servers={data.servers}>
        <Dashboard>
          <Home settings={data.settings} />
        </Dashboard>
      </SelectedProvider>
    </>
  ) : (
    <></>
  );
}

export async function getServerSideProps() {
  const helpers = await getServerSideHelpers();

  await helpers.server.getDashBoardData.prefetch();

  return {
    props: {
      trpcState: helpers.dehydrate(),
    },
  };
}
