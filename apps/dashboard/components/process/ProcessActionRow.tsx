import { Alert, Button, Menu, Stack } from "@mantine/core";
import type { IProcess, OperationAction } from "@pm2.web/typings";
import {
  IconChevronDown,
  IconChevronUp,
  IconDots,
  IconPlayerPlay,
  IconPower,
  IconRefresh,
  IconReload,
  IconTrash,
} from "@tabler/icons-react";
import { useSession } from "next-auth/react";
import { useState } from "react";

import Access from "@/utils/access";
import { PERMISSIONS } from "@/utils/permission";
import { trpc } from "@/utils/trpc";

import { OperationStatus } from "./OperationHistory";
import classes from "./Process.module.css";

interface ProcessActionProps {
  process: IProcess;
  collapse: () => void;
  expanded: boolean;
  detailsId: string;
}

export default function ProcessAction({ process, collapse, expanded, detailsId }: ProcessActionProps) {
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
  const stateAction = process.status === "online" ? "stop" : "start";
  const primaryActions = [actions[2], actions[stateAction === "stop" ? 1 : 0]];
  const moreActions = actions.filter(({ action }) => action !== "restart" && action !== stateAction);

  return (
    <Stack gap="xs" className={classes.actions}>
      <div className={classes.actionButtons}>
        {primaryActions.map(({ action, label, permission, Icon }) => (
          <Button
            key={action}
            variant={action === "restart" ? "light" : "default"}
            color="indigo"
            size="xs"
            className={classes.actionButton}
            aria-label={label}
            leftSection={<Icon size={16} />}
            loading={processAction.isPending && processAction.variables?.action === action}
            disabled={processAction.isPending || !allowed(permission)}
            onClick={() => enqueue(action)}
          >
            {action === "restart" ? "Restart" : action === "stop" ? "Stop" : "Start"}
          </Button>
        ))}
        <Button
          variant={expanded ? "light" : "subtle"}
          color="gray"
          size="xs"
          className={`${classes.actionButton} ${classes.detailsButton}`}
          onClick={collapse}
          aria-label="Toggle process details"
          aria-expanded={expanded}
          aria-controls={detailsId}
          rightSection={expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        >
          Details
        </Button>
        <Menu position="bottom-end" withinPortal width={280}>
          <Menu.Target>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              className={classes.actionButton}
              aria-label="More process actions"
              leftSection={<IconDots size={16} />}
            >
              More
            </Button>
          </Menu.Target>
          <Menu.Dropdown className={classes.moreMenu}>
            <Menu.Label>Additional actions</Menu.Label>
            {moreActions.map(({ action, label, permission, color, Icon }) => (
              <Menu.Item
                key={action}
                color={action === "delete" ? "var(--ops-danger)" : undefined}
                leftSection={<Icon size={16} color={`var(--mantine-color-${color}-6)`} />}
                disabled={processAction.isPending || !allowed(permission)}
                onClick={() => enqueue(action)}
              >
                {label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </div>
      {processAction.error && <Alert color="red">{processAction.error.message}</Alert>}
      {operationId && <OperationStatus id={operationId} />}
    </Stack>
  );
}
