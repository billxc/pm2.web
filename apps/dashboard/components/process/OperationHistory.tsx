import { Alert, Badge, Card, Group, Loader, Stack, Text } from "@mantine/core";
import type { IOperation } from "@pm2.web/typings";

import { trpc } from "@/utils/trpc";

function OperationRecord({ operation }: { operation: IOperation }) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          {operation.action} · PM2 {operation.pm_id ?? "—"}
        </Text>
        <Badge
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
      <Text size="xs" c="dimmed">
        {new Date(operation.createdAt).toLocaleString()} · {operation.actor.name} · {operation._id}
      </Text>
      {operation.startedAt && (
        <Text size="xs" c="dimmed">
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
        <Text size="sm">
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
      <Text fw={600}>Operation history (latest 30)</Text>
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {query.isPending && <Loader size="sm" />}
      {query.data?.length === 0 && (
        <Text size="sm" c="dimmed">
          No operations yet. Non-admin users see only their own permitted operations.
        </Text>
      )}
      {query.data?.map((operation) => (
        <OperationRecord key={operation._id} operation={operation} />
      ))}
    </Stack>
  );
}
