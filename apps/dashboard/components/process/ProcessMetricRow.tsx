import { Group, Progress, Text, Tooltip } from "@mantine/core";
import { IProcess } from "@pm2.web/typings";
import { IconCpu, IconDeviceSdCard, IconHistory } from "@tabler/icons-react";
import ms from "ms";

import { formatBytes } from "@/utils/format";
import { trpc } from "@/utils/trpc";

import classes from "./Process.module.css";
import ProcessGitMetric from "./ProcessGitMetric";

interface ProcessActionProps {
  process: IProcess;
  refetchInterval: number;
  showMetric: boolean;
}

export default function ProcessMetricRow({ process, refetchInterval, showMetric }: ProcessActionProps) {
  const getStat = trpc.process.getStat.useQuery(
    { processId: process._id },
    {
      refetchInterval,
    },
  );

  const cpuValue = showMetric ? getStat.data?.cpu || 0 : 0;
  const memValue = showMetric ? getStat.data?.memory || 0 : 0;

  return (
    <div className={classes.metrics}>
      <Tooltip label={`CPU: ${cpuValue.toFixed(1)}%`}>
        <div className={classes.metric}>
          <Group gap={4} wrap="nowrap" className={classes.metricLabel}>
            <IconCpu size={14} aria-hidden="true" /> CPU
          </Group>
          <Text className={classes.metricValue}>{showMetric ? `${cpuValue.toFixed(0)}%` : "-"}</Text>
          <Progress
            className={classes.metricTrack}
            value={Math.min(cpuValue, 100)}
            color="indigo"
            size={3}
            radius="xl"
          />
        </div>
      </Tooltip>
      <Tooltip label={`RAM: ${formatBytes(memValue)}`}>
        <div className={classes.metric}>
          <Group gap={4} wrap="nowrap" className={classes.metricLabel}>
            <IconDeviceSdCard size={14} aria-hidden="true" /> RAM
          </Group>
          <Text className={classes.metricValue}>{showMetric ? formatBytes(memValue) : "-"}</Text>
          <Progress
            className={classes.metricTrack}
            value={Math.min((memValue / (1024 * 1024 * 1024)) * 100, 100)}
            color="teal"
            size={3}
            radius="xl"
          />
        </div>
      </Tooltip>
      <div className={classes.metric}>
        <Group gap={4} wrap="nowrap" className={classes.metricLabel}>
          <IconHistory size={14} aria-hidden="true" /> UPTIME
        </Group>
        <Text className={classes.metricValue}>{showMetric ? ms(getStat.data?.uptime || 0) : "-"}</Text>
      </div>
      {process?.versioning?.url && (
        <div className={classes.git}>
          <ProcessGitMetric versioning={process.versioning} />
        </div>
      )}
    </div>
  );
}
