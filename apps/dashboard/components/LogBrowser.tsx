import { Alert, Badge, Button, Card, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { FormEvent, useState } from "react";

import { trpc } from "@/utils/trpc";

import classes from "./process/Process.module.css";

type LogType = "stdout" | "error" | "event";
type Cursor = { timestamp: Date; id: string };
interface Props {
  processId?: string;
  processIds?: string[];
  refetchInterval: number;
}
const emptyFilters = { text: "", type: "", start: "", end: "", serverId: "", processId: "" };

/** Both dashboard and process views use the same server-authorized historical API. */
export default function LogBrowser({ processId, processIds, refetchInterval }: Props) {
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [cursors, setCursors] = useState<(Cursor | undefined)[]>([undefined]);
  const [downloading, setDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState("");
  const utils = trpc.useUtils();
  const page = cursors.length;
  const filters = {
    text: applied.text,
    type: (applied.type || undefined) as LogType | undefined,
    start: applied.start ? new Date(applied.start) : undefined,
    end: applied.end ? new Date(applied.end) : undefined,
    serverId: applied.serverId || undefined,
    processId: processId || applied.processId || undefined,
    processIds,
  };
  const logs = trpc.logs.query.useQuery(
    { filters, cursor: cursors.at(-1), pageSize: 50 },
    { refetchInterval: page === 1 ? Math.max(1000, refetchInterval) : false },
  );
  const update = (field: keyof typeof draft, value: string) =>
    setDraft((previous) => ({ ...previous, [field]: value }));
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied(draft);
    setCursors([undefined]);
    setDownloadNotice("");
  };
  const download = async () => {
    setDownloading(true);
    setDownloadNotice("");
    try {
      const result = await utils.client.logs.download.query({ filters });
      const url = URL.createObjectURL(new Blob([result.content], { type: "application/x-ndjson;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "logs.ndjson";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadNotice(
        `Downloaded ${result.count} entries.${result.truncated ? " Export limit reached; narrow your filters for more." : ""}`,
      );
    } catch (error) {
      setDownloadNotice(error instanceof Error ? error.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className={classes.logs}>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Logs</Text>
          <Badge color={page === 1 ? "teal" : "gray"}>{page === 1 ? "Live · page 1" : `History · page ${page}`}</Badge>
        </Group>
        <form onSubmit={apply}>
          <div className={classes.logForm}>
            <TextInput
              label="Literal text search"
              placeholder="Search messages (not regex)"
              maxLength={200}
              value={draft.text}
              onChange={(event) => update("text", event.currentTarget.value)}
            />
            <div className={classes.logFilters}>
              <Select
                label="Type"
                data={[
                  { value: "stdout", label: "stdout" },
                  { value: "error", label: "error" },
                  { value: "event", label: "event" },
                ]}
                clearable
                placeholder="All types"
                value={draft.type || null}
                onChange={(value) => update("type", value || "")}
              />
              <TextInput
                label="Start (local time)"
                type="datetime-local"
                value={draft.start}
                onChange={(event) => update("start", event.currentTarget.value)}
              />
              <TextInput
                label="End (local time)"
                type="datetime-local"
                value={draft.end}
                onChange={(event) => update("end", event.currentTarget.value)}
              />
            </div>
            {!processId && (
              <div className={classes.logIds}>
                <TextInput
                  label="Server ID (optional)"
                  placeholder="24-character ID"
                  value={draft.serverId}
                  onChange={(event) => update("serverId", event.currentTarget.value.trim())}
                />
                <TextInput
                  label="Process ID (optional)"
                  placeholder="Within selected dashboard processes"
                  value={draft.processId}
                  onChange={(event) => update("processId", event.currentTarget.value.trim())}
                />
              </div>
            )}
            <div className={classes.logActions}>
              <Button type="submit" size="xs">
                Apply filters
              </Button>
              <Button size="xs" variant="light" onClick={download} loading={downloading}>
                Download latest matches
              </Button>
            </div>
          </div>
        </form>
        <Text size="xs" c="dimmed">
          Retention: 7 days from collection; disk history is not imported. Download: newest 5,000 matches, max 5 MiB
          NDJSON. Messages over 16,384 characters are marked and clipped in this view/export. Newest first.
        </Text>
        {page > 1 && (
          <Text size="xs" c="dimmed">
            Live refresh paused while browsing history. Latest resumes polling.
          </Text>
        )}
        {downloadNotice && (
          <Text size="sm" role="status">
            {downloadNotice}
          </Text>
        )}
        {logs.error && (
          <Alert color="red" title="Unable to load logs">
            {logs.error.message}
          </Alert>
        )}
        <Stack
          gap={0}
          mah="55dvh"
          mih={120}
          className={classes.logOutput}
          aria-label="Log messages"
          role="region"
          tabIndex={0}
          aria-live={page === 1 ? "polite" : "off"}
        >
          {logs.isLoading && <Text size="sm">Loading logs…</Text>}
          {!logs.isLoading && !logs.error && !logs.data?.items.length && <Text size="sm">No matching logs</Text>}
          {logs.data?.items.map((log) => (
            <Text
              key={log.id}
              size="sm"
              component="pre"
              m={0}
              c={log.type === "error" ? "red.6" : log.type === "stdout" ? "teal.6" : "blue.5"}
              className={classes.logLine}
            >
              {new Date(log.timestamp).toLocaleString()} [{log.type}] {log.message}
              {log.messageTruncated ? " [message clipped]" : ""}
            </Text>
          ))}
        </Stack>
        <Group justify="space-between" wrap="wrap" gap="xs" className={classes.pagination}>
          <Group gap="xs">
            <Button
              size="xs"
              variant="default"
              disabled={page === 1}
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
            >
              Previous
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={!logs.data?.nextCursor || logs.isFetching}
              onClick={() => {
                if (logs.data?.nextCursor) setCursors((previous) => [...previous, logs.data.nextCursor!]);
              }}
            >
              Older
            </Button>
          </Group>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              setCursors([undefined]);
              void logs.refetch();
            }}
          >
            Latest / refresh
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
