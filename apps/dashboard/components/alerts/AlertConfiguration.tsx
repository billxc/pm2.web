import { Alert, Button, Card, Checkbox, Group, NumberInput, PasswordInput, Stack, Text, Title } from "@mantine/core";
import type { AlertConfigView } from "@pm2.web/typings";
import { useState } from "react";

import { trpc } from "@/utils/trpc";

function ConfigurationForm({ config }: { config: AlertConfigView }) {
  const utils = trpc.useUtils();
  const [offline, setOffline] = useState(config.offlineThresholdSeconds);
  const [threshold, setThreshold] = useState(config.restartThreshold);
  const [window, setWindow] = useState(config.restartWindowSeconds);
  const [enabled, setEnabled] = useState(config.webhookEnabled);
  const [url, setUrl] = useState("");
  const [clear, setClear] = useState(false);
  const mutation = trpc.alerts.updateConfig.useMutation({
    onSuccess: async () => {
      setUrl("");
      setClear(false);
      await utils.alerts.getConfig.invalidate();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({
          offlineThresholdSeconds: offline,
          restartThreshold: threshold,
          restartWindowSeconds: window,
          webhookEnabled: enabled,
          ...(clear ? { webhookUrl: null } : url.trim() ? { webhookUrl: url.trim() } : {}),
        });
      }}
    >
      <Stack>
        <Group grow align="start">
          <NumberInput
            label="主机离线阈值（秒）"
            min={10}
            max={86400}
            allowDecimal={false}
            value={offline}
            onChange={(v) => setOffline(Number(v))}
            required
          />
          <NumberInput
            label="窗口内重启次数"
            min={1}
            max={10000}
            allowDecimal={false}
            value={threshold}
            onChange={(v) => setThreshold(Number(v))}
            required
          />
          <NumberInput
            label="重启窗口（秒）"
            min={10}
            max={3600}
            allowDecimal={false}
            value={window}
            onChange={(v) => setWindow(Number(v))}
            required
          />
        </Group>
        <Text size="sm">
          默认只显示面板告警。Webhook {config.webhookConfigured ? "已配置（地址隐藏）" : "未配置，禁用"}
          。保存配置不会发送测试消息。
        </Text>
        <Checkbox
          label="启用通用 Webhook（仅新告警和恢复时发送）"
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
        />
        <PasswordInput
          label="写入 / 替换 Webhook URL"
          placeholder="留空保留原地址"
          autoComplete="new-password"
          value={url}
          disabled={clear}
          onChange={(e) => setUrl(e.currentTarget.value)}
        />
        <Text size="xs" c="dimmed">
          仅 HTTP(S)，不允许 URL 用户密码或片段。推荐 HTTPS。可访问内网，仅应配置管理员信任的目标；地址不会从 API 返回。
        </Text>
        <Checkbox
          label="清除已存地址"
          checked={clear}
          onChange={(e) => {
            setClear(e.currentTarget.checked);
            if (e.currentTarget.checked) setEnabled(false);
          }}
        />
        {mutation.isError && <Alert color="red">配置保存失败，请检查阈值和地址；启用前必须配置 Webhook。</Alert>}
        {mutation.isSuccess && (
          <Text c="green" size="sm">
            已保存；未发送测试消息。
          </Text>
        )}
        <Button
          type="submit"
          loading={mutation.isPending}
          disabled={enabled && (clear || (!config.webhookConfigured && !url.trim()))}
        >
          保存告警配置
        </Button>
      </Stack>
    </form>
  );
}

export function AlertConfiguration() {
  const query = trpc.alerts.getConfig.useQuery(undefined, { refetchOnWindowFocus: false });
  return (
    <Card withBorder>
      <Stack>
        <Title order={3}>告警配置（管理员 / 所有者）</Title>
        {query.isError && <Alert color="red">无法读取告警配置。</Alert>}
        {query.data && <ConfigurationForm key={JSON.stringify(query.data)} config={query.data} />}
      </Stack>
    </Card>
  );
}
