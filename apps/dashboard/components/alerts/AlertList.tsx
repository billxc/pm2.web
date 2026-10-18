import { Alert, Badge, Button, Card, Group, Loader, Select, Stack, Table, Text, Title } from "@mantine/core";
import type { AlertStatus } from "@pm2.web/typings";
import { useState } from "react";

import { trpc } from "@/utils/trpc";

const statusLabels = { open: "未确认", acknowledged: "已确认", resolved: "已恢复" };
const formatTime = (value?: Date | string) => (value ? new Date(value).toLocaleString() : "—");

export function AlertList({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<AlertStatus | undefined>();
  const query = trpc.alerts.list.useInfiniteQuery(
    { status, limit: 30 },
    {
      getNextPageParam: (last) => last.nextCursor,
      refetchInterval: 10_000,
    },
  );
  const acknowledge = trpc.alerts.acknowledge.useMutation({
    onSuccess: async () => {
      await utils.alerts.list.invalidate();
    },
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Card withBorder>
      <Stack>
        <Group justify="space-between">
          <Title order={2}>告警</Title>
          <Group>
            <Select
              aria-label="告警状态"
              value={status ?? "all"}
              onChange={(v) => setStatus(v === "all" || !v ? undefined : (v as AlertStatus))}
              data={[
                { value: "all", label: "全部状态" },
                { value: "open", label: "未确认" },
                { value: "acknowledged", label: "已确认" },
                { value: "resolved", label: "已恢复" },
              ]}
            />
            <Button variant="light" onClick={() => void query.refetch()}>
              刷新
            </Button>
          </Group>
        </Group>
        <Text size="sm" c="dimmed">
          只显示你有监控权限的目标。确认不会消除故障；恢复由中央扫描器检测。
        </Text>
        {query.isLoading && <Loader size="sm" />}
        {query.isError && <Alert color="red">读取告警失败，请稍后重试。</Alert>}
        {acknowledge.isError && <Alert color="red">确认失败，需要管理员 / 所有者权限。</Alert>}
        {!query.isLoading && !query.isError && items.length === 0 && <Text>暂无可见告警。</Text>}
        {items.length > 0 && (
          <Table.ScrollContainer minWidth={850}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>类型 / 目标</Table.Th>
                  <Table.Th>原因</Table.Th>
                  <Table.Th>时间</Table.Th>
                  <Table.Th>状态</Table.Th>
                  <Table.Th>通知 / 操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((event) => (
                  <Table.Tr key={event._id}>
                    <Table.Td>
                      <Text fw={600}>{event.kind === "host_offline" ? "主机离线" : "连续重启"}</Text>
                      <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                        {event.targetName}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{event.reason}</Text>
                      {event.recoveryReason && (
                        <Text size="sm" c="dimmed">
                          {event.recoveryReason}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">发生：{formatTime(event.openedAt)}</Text>
                      {event.acknowledgedAt && <Text size="xs">确认：{formatTime(event.acknowledgedAt)}</Text>}
                      {event.resolvedAt && <Text size="xs">恢复：{formatTime(event.resolvedAt)}</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={
                          event.status === "resolved" ? "green" : event.status === "acknowledged" ? "yellow" : "red"
                        }
                      >
                        {statusLabels[event.status]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap="xs">
                        <Text size="xs">
                          告警：{event.openDelivery}
                          {event.openDeliveryError ? ` (${event.openDeliveryError})` : ""}
                        </Text>
                        {event.status === "resolved" && (
                          <Text size="xs">
                            恢复：{event.recoveryDelivery}
                            {event.recoveryDeliveryError ? ` (${event.recoveryDeliveryError})` : ""}
                          </Text>
                        )}
                        {canManage && event.status === "open" && (
                          <Button
                            size="xs"
                            variant="light"
                            loading={acknowledge.isPending && acknowledge.variables?.id === event._id}
                            onClick={() => acknowledge.mutate({ id: event._id })}
                          >
                            确认
                          </Button>
                        )}
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {query.hasNextPage && (
          <Button variant="light" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            加载更多
          </Button>
        )}
      </Stack>
    </Card>
  );
}
