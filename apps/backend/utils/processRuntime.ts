import type { IProcessRuntime } from "@pm2.web/typings";

import type { Pm2ProcessDescription } from "../types/pm2";

const secretName = String.raw`[\w-]*(?:password|passwd|token|secret|api[-_]?key|authorization|access[-_]?key)`;
const secretOption = new RegExp(`^(-{1,2}${secretName})(?:=(.*))?$`, "i");
const rawSecretOption = new RegExp(
  String.raw`((?:^|\s)-{1,2}${secretName}(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)`,
  "gi",
);

function redactText(value: string): string {
  return value
    .replace(rawSecretOption, "$1[redacted]")
    .replaceAll(/(\b[a-z][\da-z+.-]*:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
    .replaceAll(
      /([?&](?:[\w-]*(?:token|password|secret|api[-_]?key))=)[^&#\s]*/gi,
      "$1[redacted]",
    )
    .replaceAll(
      /(\b[\w]*(?:TOKEN|PASSWORD|SECRET|API_KEY)=)(?:"[^"]*"|'[^']*'|[^\s;]+)/g,
      "$1[redacted]",
    );
}

export default function getProcessRuntime(
  item: Pm2ProcessDescription,
  platform: NodeJS.Platform = process.platform,
): IProcessRuntime {
  const env = item.pm2_env;
  const quote = (value: string) =>
    platform === "win32"
      ? `'${value.replaceAll("'", "''")}'`
      : `'${value.replaceAll("'", String.raw`'\''`)}'`;

  const formatArgs = (args?: string | string[]): string => {
    if (typeof args === "string") return redactText(args);
    let isHideNext = false;
    return (args ?? [])
      .map((value) => {
        if (isHideNext) {
          isHideNext = false;
          return quote("[redacted]");
        }
        const option = value.match(secretOption);
        if (option) {
          isHideNext = option[2] === undefined;
          return quote(isHideNext ? value : `${option[1]}=[redacted]`);
        }
        return quote(redactText(value));
      })
      .join(" ");
  };

  const script = env?.pm_exec_path;
  const interpreter = env?.exec_interpreter;
  const command = script
    ? [
        platform === "win32" ? "&" : "",
        interpreter && interpreter !== "none"
          ? quote(redactText(interpreter))
          : "",
        interpreter && interpreter !== "none"
          ? formatArgs(env?.node_args ?? env?.interpreter_args)
          : "",
        quote(redactText(script)),
        formatArgs(env?.args),
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;

  return {
    command,
    script,
    cwd: env?.pm_cwd,
    interpreter,
    pid: item.pid,
    mode: env?.exec_mode,
    restarts: env?.restart_time,
    exitCode: env?.exit_code,
    unstableRestarts: env?.unstable_restarts,
    platform,
  };
}
