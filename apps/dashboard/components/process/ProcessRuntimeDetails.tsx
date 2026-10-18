import { ActionIcon, Card, Code, CopyButton, Group, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { IProcessRuntime } from "@pm2.web/typings";
import { IconCheck, IconCopy } from "@tabler/icons-react";

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
    <Card radius="md" p="sm" m="xs" withBorder>
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
              {runtime.command && (
                <CopyButton value={runtime.command}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy PM2 command"}>
                      <ActionIcon
                        variant="subtle"
                        color={copied ? "teal" : "gray"}
                        size="sm"
                        onClick={() => {
                          if (navigator.clipboard) return copy();
                          // The LAN deployment uses HTTP, where Clipboard API is unavailable.
                          const input = document.createElement("textarea");
                          input.value = runtime.command!;
                          document.body.append(input);
                          input.select();
                          document.execCommand("copy");
                          input.remove();
                        }}
                        aria-label={copied ? "Copied" : "Copy PM2 command"}
                      >
                        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              )}
            </Group>
            <Code block style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {runtime.command || "—"}
            </Code>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" verticalSpacing="xs">
              {details.map(([label, value]) => (
                <Stack key={label} gap={2} style={{ minWidth: 0 }}>
                  <Text size="xs" c="dimmed">
                    {label}
                  </Text>
                  <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                    {value ?? "—"}
                  </Text>
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
