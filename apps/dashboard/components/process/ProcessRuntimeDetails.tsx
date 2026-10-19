import { ActionIcon, Card, Code, CopyButton, Group, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { IProcessRuntime } from "@pm2.web/typings";
import { IconCheck, IconCopy } from "@tabler/icons-react";

import classes from "./Process.module.css";

function CopyRuntimeValue({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : `Copy ${label}`}>
          <ActionIcon
            className={classes.copyButton}
            variant="subtle"
            color={copied ? "teal" : "gray"}
            onClick={() => {
              if (navigator.clipboard) return copy();
              const input = document.createElement("textarea");
              input.value = value;
              document.body.append(input);
              input.select();
              document.execCommand("copy");
              input.remove();
            }}
            aria-label={copied ? "Copied" : `Copy ${label}`}
          >
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}

export default function ProcessRuntimeDetails({ runtime }: { runtime?: IProcessRuntime }) {
  const details = [
    ["Script", runtime?.script],
    ["Working directory (cwd)", runtime?.cwd],
    ["Interpreter", runtime?.interpreter],
    ["OS PID", runtime?.pid || "—"],
    ["Execution mode", runtime?.mode],
    ["Restarts", runtime?.restarts],
    ["Unstable restarts", runtime?.unstableRestarts],
    ["Last exit code", runtime?.exitCode],
  ];

  return (
    <Card className={classes.runtime}>
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          PM2 launch configuration
        </Text>
        {runtime ? (
          <>
            <Group justify="space-between" gap="xs">
              <Text size="xs" c="dimmed">
                PM2 command ({runtime.platform === "win32" ? "PowerShell" : "shell"})
              </Text>
              {runtime.command && <CopyRuntimeValue value={runtime.command} label="PM2 command" />}
            </Group>
            <Code block className={classes.command}>
              {runtime.command || "—"}
            </Code>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" verticalSpacing="xs">
              {details.map(([label, value]) => (
                <Stack key={label} gap={2} style={{ minWidth: 0 }}>
                  <Text size="xs" c="dimmed">
                    {label}
                  </Text>
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Text size="sm" className={classes.runtimeValue} style={{ flex: 1, minWidth: 0 }}>
                      {value ?? "—"}
                    </Text>
                    {(label === "Script" || label === "Working directory (cwd)") &&
                      typeof value === "string" &&
                      value && <CopyRuntimeValue value={value} label={label} />}
                  </Group>
                </Stack>
              ))}
            </SimpleGrid>
          </>
        ) : (
          <Text size="sm" c="dimmed">
            Runtime details not reported yet.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
