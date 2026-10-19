import { Alert, Badge, Card, Group, Loader, Stack, Text, Title } from "@mantine/core";
import type { IOperation } from "@pm2.web/typings";

import styles from "@/pages/PageVisuals.module.css";
import { trpc } from "@/utils/trpc";

function OperationRecord({ operation }: { operation: IOperation }) {
  return (
    <Card withBorder className={styles.record}>
      <Stack gap="xs">
        <Group justify="space-between" className={styles.recordHeader}>
          <Text size="sm" fw={600} className={styles.recordAction}>
            {operation.action} · PM2 {operation.pm_id ?? "—"}
          </Text>
          <Badge
            className={styles.recordStatus}
            color={
              operation.status === "unknown"
                ? "orange"
                : operation.status === "failed"
                  ? "red"
                  : operation.status === "succeeded"
                    ? "green"
                    : "blue"
            }
          >
            {operation.status}
          </Badge>
        </Group>
        <Text size="xs" className={styles.recordMeta}>
          {new Date(operation.createdAt).toLocaleString()} · {operation.actor.name} · {operation._id}
        </Text>
        {operation.startedAt && (
          <Text size="xs" className={styles.recordMeta}>
            Started: {new Date(operation.startedAt).toLocaleString()}
            {operation.finishedAt ? ` · Finished: ${new Date(operation.finishedAt).toLocaleString()}` : ""}
          </Text>
        )}
        {operation.error && (
          <Text size="sm" c="red">
            {operation.error}
          </Text>
        )}
        {operation.result && (
          <Text size="sm" className={styles.recordResult}>
            {operation.result.message} {operation.result.status ? `Status: ${operation.result.status}. ` : ""}
            {operation.result.saved ? "Startup list saved." : "Startup list not saved."}
          </Text>
        )}
        {operation.status === "queued" && (
          <Text size="xs">
            Waiting for this server's backend. Queued tasks expire after 10 minutes without execution.
          </Text>
        )}
        {operation.status === "running" && (
          <Text size="xs">Executing. If the backend crashed, outcome may be unknown; inspect PM2 before retrying.</Text>
        )}
        {operation.status === "unknown" && (
          <Text size="xs">
            Result unconfirmed after backend restart. Check PM2 and manually decide what to do; this task will not be
            replayed.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

export function OperationStatus({ id }: { id: string }) {
  const query = trpc.operations.get.useQuery(
    { id },
    {
      refetchInterval: (query) =>
        ["succeeded", "failed", "unknown"].includes(query.state.data?.status || "") ? false : 1500,
    },
  );
  if (query.error) return <Alert color="red">{query.error.message}</Alert>;
  return query.data ? <OperationRecord operation={query.data} /> : <Loader size="xs" />;
}

export default function OperationHistory({ serverId, processId }: { serverId?: string; processId?: string }) {
  const query = trpc.operations.list.useQuery(
    { serverId, processId, limit: 30 },
    {
      refetchInterval: (query) =>
        query.state.data?.some((operation) => ["queued", "running"].includes(operation.status)) ? 3000 : 30_000,
    },
  );
  return (
    <Stack gap="xs">
      <Title order={2} size="h4">
        Recent operations · latest 30
      </Title>
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {query.isPending && <Loader size="sm" />}
      {query.data?.length === 0 && (
        <div className={styles.empty}>
          <Text size="sm" fw={600}>
            No operations yet
          </Text>
          <Text size="sm" className={styles.muted}>
            Non-admin users see only their own permitted operations.
          </Text>
        </div>
      )}
      {query.data?.map((operation) => (
        <OperationRecord key={operation._id} operation={operation} />
      ))}
    </Stack>
  );
}
