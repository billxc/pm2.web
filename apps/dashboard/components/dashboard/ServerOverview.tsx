import { AreaChart } from "@mantine/charts";
import { Badge, Button, Group, Progress, SegmentedControl, Stack, Text, ThemeIcon } from "@mantine/core";
import { IServer, ISetting } from "@pm2.web/typings";
import { IconServer } from "@tabler/icons-react";
import ms from "ms";
import { useSession } from "next-auth/react";
import { useState } from "react";

import Access from "@/utils/access";
import { formatBytes } from "@/utils/format";
import { HISTORY_OPTIONS, type HistoryRange, historyTime } from "@/utils/history";
import { PERMISSIONS } from "@/utils/permission";
import { trpc } from "@/utils/trpc";

import { useSelected } from "../context/SelectedProvider";
import styles from "./ServerOverview.module.css";

function ServerCard({ server, settings }: { server: IServer; settings: ISetting }) {
  const { data: session, status } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [range, setRange] = useState<HistoryRange>("hour");
  const acl = session?.user?.acl;
  const canMonitor =
    !!acl && (acl.owner || acl.admin || new Access(acl.servers).getPerms(server._id, "").has(PERMISSIONS.MONITORING));
  const lastSeen = server.heartbeat || Date.parse(server.updatedAt);
  const isOnline = Date.now() - lastSeen < 60_000;
  const selection = { serverIds: [server._id], processIds: [] };
  const latest = trpc.history.latest.useQuery(selection, {
    enabled: canMonitor && isOnline,
    refetchInterval: settings.polling.frontend,
  });
  const history = trpc.history.overview.useQuery(
    { ...selection, range },
    {
      enabled: expanded && canMonitor,
      refetchInterval: range === "hour" ? 30_000 : 60_000,
    },
  );
  const metric = isOnline ? latest.data?.server : null;
  const capacity = metric?.memoryMax;
  const memoryPercent = metric?.memory != null && capacity ? (100 * metric.memory) / capacity : null;
  const platform = server.processes.find((process) => process.runtime?.platform)?.runtime?.platform;
  const platformLabel =
    platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform || "Platform not reported";
  const data = history.data?.points.map((point) => ({ ...point, date: historyTime(point.timestamp) })) || [];

  return (
    <section className={styles.card} aria-label={`System information: ${server.name}`}>
      <Group justify="space-between" align="start" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <ThemeIcon size={40} variant="light" radius="md">
            <IconServer size={21} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text fw={700} size="lg" className={styles.name}>
              {server.name}
            </Text>
            <Text size="xs" c="dimmed">
              {platformLabel}
            </Text>
          </div>
        </Group>
        <Badge color={isOnline ? "teal" : "gray"} variant="light">
          {isOnline ? "Online" : "Offline"}
        </Badge>
      </Group>
      <div className={styles.metrics}>
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              CPU
            </Text>
            <Text size="sm" className={styles.value}>
              {metric?.cpu == null ? "—" : `${metric.cpu.toFixed(1)}%`}
            </Text>
          </Group>
          <Progress value={metric?.cpu ?? 0} aria-label={`${server.name} CPU`} size="sm" />
        </Stack>
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              RAM
            </Text>
            <Text size="sm" className={styles.value}>
              {metric?.memory == null ? "—" : formatBytes(metric.memory)} / {capacity ? formatBytes(capacity) : "—"}
            </Text>
          </Group>
          <Progress value={memoryPercent ?? 0} color="teal" aria-label={`${server.name} RAM`} size="sm" />
        </Stack>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Uptime
          </Text>
          <Text size="sm" className={styles.value}>
            {metric?.uptime == null ? "—" : ms(metric.uptime)}
          </Text>
        </Group>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Visible PM2 processes
          </Text>
          <Text size="sm" className={styles.value}>
            {server.processes.filter((process) => process.status === "online").length} / {server.processes.length}
          </Text>
        </Group>
      </div>
      <Group justify="space-between" className={styles.footer} gap="sm">
        <Text size="xs" c="dimmed">
          Heartbeat {new Date(lastSeen).toISOString().slice(11, 19)} UTC
        </Text>
        <Button
          variant="subtle"
          size="xs"
          disabled={!canMonitor}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          Host history
        </Button>
      </Group>
      {isOnline && !metric && (
        <Text size="xs" c="dimmed" mt="xs">
          {status === "loading"
            ? "Loading host data…"
            : canMonitor
              ? latest.isPending
                ? "Loading host data…"
                : "No recent host sample."
              : "Host metrics require server monitoring access."}
        </Text>
      )}
      {expanded && (
        <Stack className={styles.history} gap="sm">
          <SegmentedControl
            aria-label={`${server.name} history range`}
            size="xs"
            data={HISTORY_OPTIONS}
            value={range}
            onChange={(value) => setRange(value as HistoryRange)}
          />
          <Text size="xs" c="dimmed">
            This host only · UTC · missing history is left blank
          </Text>
          <div className={styles.charts}>
            <AreaChart
              h={180}
              data={data}
              dataKey="date"
              series={[{ name: "serverCpu", color: "indigo.5", label: "CPU" }]}
              valueFormatter={(value) => `${value.toFixed(1)}%`}
              withDots={false}
              connectNulls={false}
              yAxisProps={{ width: 44 }}
            />
            <AreaChart
              h={180}
              data={data}
              dataKey="date"
              series={[{ name: "serverRam", color: "teal.5", label: "RAM" }]}
              valueFormatter={formatBytes}
              withDots={false}
              connectNulls={false}
              yAxisProps={{ width: 56 }}
            />
          </div>
        </Stack>
      )}
    </section>
  );
}

export default function ServerOverview({ settings }: { settings: ISetting }) {
  const { selectedServers } = useSelected();
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={650}>Your machines</Text>
        <Badge variant="light">{selectedServers.length} hosts</Badge>
      </Group>
      <Text size="sm" c="dimmed">
        Each card shows one machine, not an average. Use Filters to focus on specific hosts.
      </Text>
      <div className={styles.grid}>
        {selectedServers.map((server) => (
          <ServerCard key={server._id} server={server} settings={settings} />
        ))}
      </div>
    </Stack>
  );
}
