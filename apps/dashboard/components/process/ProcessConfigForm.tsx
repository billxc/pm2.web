import { Alert, Button, Checkbox, Modal, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import type { IProcess, ProcessConfigPatch } from "@pm2.web/typings";
import { useSession } from "next-auth/react";
import { useState } from "react";

import { trpc } from "@/utils/trpc";

import { OperationStatus } from "./OperationHistory";

export default function ProcessConfigForm({
  process,
  servers = [],
}: {
  process?: IProcess;
  servers?: { _id: string; name: string }[];
}) {
  const { data: session } = useSession();
  const [opened, setOpened] = useState(false);
  const [serverId, setServerId] = useState<string | null>(process?.server || servers[0]?._id || null);
  const [fields, setFields] = useState({
    name: "",
    script: "",
    cwd: "",
    interpreter: "",
    args: "",
    interpreterArgs: "",
    env: "",
  });
  const [autostart, setAutostart] = useState(true);
  const [saveStartup, setSaveStartup] = useState(false);
  const [error, setError] = useState("");
  const [operationId, setOperationId] = useState<string>();
  const mutation = trpc.operations.enqueue.useMutation({
    onSuccess: (operation) => {
      setOperationId(operation._id);
      setFields({ name: "", script: "", cwd: "", interpreter: "", args: "", interpreterArgs: "", env: "" });
    },
  });
  if (!session?.user?.acl?.admin && !session?.user?.acl?.owner) return null;
  function submit() {
    setError("");
    try {
      if (!serverId) throw new Error("Select a server");
      const config: ProcessConfigPatch = {};
      for (const key of ["name", "script", "cwd", "interpreter"] as const) if (fields[key]) config[key] = fields[key];
      for (const key of ["args", "interpreterArgs"] as const) {
        if (!fields[key]) continue;
        const value: unknown = JSON.parse(fields[key]);
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
          throw new Error(`${key} must be a JSON string array`);
        config[key] = value;
      }
      if (fields.env) {
        const value: unknown = JSON.parse(fields.env);
        if (
          !value ||
          Array.isArray(value) ||
          typeof value !== "object" ||
          !Object.values(value).every((entry) => typeof entry === "string")
        )
          throw new Error("Environment patch must be a JSON object with string values");
        config.env = value as Record<string, string>;
      }
      if (!process) config.autostart = autostart;
      mutation.mutate({
        serverId,
        processId: process?._id,
        action: process ? "update" : "create",
        config,
        saveStartup,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid configuration");
    }
  }
  return (
    <>
      <Button size="xs" variant={process ? "subtle" : "filled"} onClick={() => setOpened(true)}>
        {process ? "Edit configuration" : "Add process"}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={process ? `Edit ${process.name}` : "Add PM2 process"}
        size="lg"
      >
        <Stack gap="sm">
          <Alert color="yellow">
            Admin-only local PM2 configuration, not a remote shell. Changes are not saved for reboot unless selected
            below.{" "}
            {process
              ? "Updates restart the online process and preserve unspecified settings. Stopped processes are rejected without starting them."
              : "Script and cwd must be absolute paths on the selected backend server."}
          </Alert>
          {!process && (
            <Select
              label="Server"
              data={servers.map((server) => ({ value: server._id, label: server.name }))}
              value={serverId}
              onChange={setServerId}
              required
            />
          )}
          <Text size="xs" c="dimmed">
            {process
              ? "Leave fields blank to keep unchanged. No existing environment or argument values are fetched. Use [] to clear arguments."
              : "Arguments are JSON arrays, not shell command strings."}
          </Text>
          {(
            [
              ["name", "Name", process?.name],
              ["script", "Script (absolute local path)", process?.runtime?.script],
              ["cwd", "Working directory (absolute local path)", process?.runtime?.cwd],
              ["interpreter", "Interpreter (or none)", process?.runtime?.interpreter],
            ] as const
          ).map(([key, label, placeholder]) => (
            <TextInput
              key={key}
              label={label}
              placeholder={placeholder || ""}
              value={fields[key]}
              onChange={(event) => setFields({ ...fields, [key]: event.currentTarget.value })}
              autoComplete="off"
            />
          ))}
          <Textarea
            label="Arguments (JSON string array)"
            placeholder={'["--port", "3000"]'}
            value={fields.args}
            onChange={(event) => setFields({ ...fields, args: event.currentTarget.value })}
          />
          <Textarea
            label="Interpreter arguments (JSON string array)"
            placeholder={'["--max-old-space-size=1024"]'}
            value={fields.interpreterArgs}
            onChange={(event) => setFields({ ...fields, interpreterArgs: event.currentTarget.value })}
          />
          <Textarea
            label="Environment patch (write-only JSON object)"
            description="Only supplied keys are changed. Existing environment is never displayed. Queued patches are stored privately until execution; prefer local secret files for credentials."
            placeholder={'{"NODE_ENV":"production"}'}
            value={fields.env}
            onChange={(event) => setFields({ ...fields, env: event.currentTarget.value })}
            autoComplete="off"
          />
          {!process && (
            <Checkbox
              label="Start immediately (otherwise create stopped)"
              checked={autostart}
              onChange={(event) => setAutostart(event.currentTarget.checked)}
            />
          )}
          <Checkbox
            label="Also save the entire server's current PM2 startup list after success"
            checked={saveStartup}
            onChange={(event) => setSaveStartup(event.currentTarget.checked)}
          />
          {(error || mutation.error) && <Alert color="red">{error || mutation.error?.message}</Alert>}
          <Button loading={mutation.isPending} onClick={submit}>
            Queue {process ? "configuration update" : "new process"}
          </Button>
          {operationId && <OperationStatus id={operationId} />}
        </Stack>
      </Modal>
    </>
  );
}
