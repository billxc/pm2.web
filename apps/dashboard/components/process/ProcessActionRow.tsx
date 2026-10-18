import { ActionIcon, Alert, Flex, Stack, Tooltip } from "@mantine/core";
import type { IProcess, OperationAction } from "@pm2.web/typings";
import {
  IconPlayerPlay,
  IconPower,
  IconRefresh,
  IconReload,
  IconSquareRoundedMinus,
  IconTrash,
} from "@tabler/icons-react";
import { useSession } from "next-auth/react";
import { useState } from "react";

import Access from "@/utils/access";
import { PERMISSIONS } from "@/utils/permission";
import { trpc } from "@/utils/trpc";

import { OperationStatus } from "./OperationHistory";

interface ProcessActionProps {
  process: IProcess;
  collapse: () => void;
}

export default function ProcessAction({ process, collapse }: ProcessActionProps) {
  const { data: session } = useSession();
  const [operationId, setOperationId] = useState<string>();
  const processAction = trpc.operations.enqueue.useMutation({
    onSuccess: (operation) => setOperationId(operation._id),
  });
  const user = session?.user;
  const allowed = (permission: number) =>
    Boolean(
      user?.acl &&
      (user.acl.owner ||
        user.acl.admin ||
        new Access(user.acl.servers || []).getPerms(process.server.toString(), process._id.toString()).has(permission)),
    );
  const actions = [
    { action: "start", label: "Start process", permission: PERMISSIONS.RESTART, color: "green", Icon: IconPlayerPlay },
    { action: "stop", label: "Stop process", permission: PERMISSIONS.STOP, color: "orange", Icon: IconPower },
    { action: "restart", label: "Restart process", permission: PERMISSIONS.RESTART, color: "blue", Icon: IconReload },
    {
      action: "reload",
      label: "Reload process (fork mode: no zero-downtime guarantee)",
      permission: PERMISSIONS.RESTART,
      color: "cyan",
      Icon: IconRefresh,
    },
    { action: "delete", label: "Delete process", permission: PERMISSIONS.DELETE, color: "red", Icon: IconTrash },
  ] as const;
  function enqueue(action: OperationAction) {
    if (
      action === "delete" &&
      !window.confirm(`Delete ${process.name} from PM2? The startup list is not saved automatically.`)
    )
      return;
    processAction.mutate({
      serverId: process.server.toString(),
      processId: process._id.toString(),
      action,
      saveStartup: false,
    });
  }
  return (
    <Stack gap="xs" maw={540}>
      <Flex gap="5px" wrap="wrap">
        {actions.map(({ action, label, permission, color, Icon }) => (
          <Tooltip key={action} label={label}>
            <ActionIcon
              variant="light"
              color={color}
              aria-label={label}
              radius="sm"
              size="lg"
              loading={processAction.isPending && processAction.variables?.action === action}
              disabled={processAction.isPending || !allowed(permission)}
              onClick={() => enqueue(action)}
            >
              <Icon size="1.4rem" />
            </ActionIcon>
          </Tooltip>
        ))}
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="sm"
          size="lg"
          onClick={collapse}
          aria-label="Toggle process details"
        >
          <IconSquareRoundedMinus size="1.2rem" />
        </ActionIcon>
      </Flex>
      {processAction.error && <Alert color="red">{processAction.error.message}</Alert>}
      {operationId && <OperationStatus id={operationId} />}
    </Stack>
  );
}
