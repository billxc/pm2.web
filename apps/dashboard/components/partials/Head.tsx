import { AppShell, Badge, Burger, Button, Flex, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IProcess } from "@pm2.web/typings";
import { IconCircleFilled, IconFilterCog, IconLock, IconServerCog } from "@tabler/icons-react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

import Access from "@/utils/access";

import { useSelected } from "../context/SelectedProvider";
import classes from "../layouts/Dashboard.module.css";
import { CustomMultiSelect, IItem } from "../misc/MultiSelect/CustomMultiSelect";
import { WorkspaceBrand } from "./WorkspaceBrand";

const pageDetails: Record<string, { title: string; description: string }> = {
  "/": { title: "Overview", description: "A clear view of your running services" },
  "/process": { title: "Processes", description: "Runtime status, logs and configuration" },
  "/operations": { title: "Operations", description: "Changes, execution results and history" },
  "/alerts": { title: "Alerts", description: "Incidents, recovery and notification rules" },
  "/settings": { title: "Settings", description: "Workspace and account preferences" },
  "/user": { title: "Users & access", description: "Accounts and application permissions" },
};

export function Head({ mobileOpened, toggleMobile }: { mobileOpened?: boolean; toggleMobile?: () => void }) {
  const { servers, selectItem, selectedItem } = useSelected();
  const { data: session } = useSession();
  const router = useRouter();
  const [opened, { open, close }] = useDisclosure(false);
  const isPhone = useMediaQuery("(max-width: 47.99em)");
  const page = pageDetails[router.pathname] || pageDetails["/"];
  const processCount = servers.reduce((sum, server) => sum + server.processes.length, 0);
  const selectionCount = selectedItem.servers.length + selectedItem.processes.length;
  const isFresh = servers.every((server) => new Date(server.updatedAt).getTime() > Date.now() - 60_000);
  const hasAccess = (serverId: string, processId: string) => {
    const acl = session?.user?.acl;
    return !!acl && (acl.owner || acl.admin || !!new Access(acl.servers).getPermsValue(serverId, processId));
  };

  return (
    <AppShell.Header className={classes.header}>
      <Modal opened={opened} onClose={close} title="Server/Process Filter" size="lg" fullScreen={isPhone} zIndex={200}>
        <Stack gap="lg">
          <Text c="dimmed" size="sm">
            Choose the services you want to focus on. Leave a field empty to show all.
          </Text>
          <CustomMultiSelect
            label="Servers"
            aria-label="Select Server"
            leftSection={<IconServerCog size={18} />}
            value={selectedItem.servers}
            data={servers.map((server) => ({
              value: server._id,
              label: server.name,
              status: new Date(server.updatedAt).getTime() > Date.now() - 60_000 ? "online" : "offline",
              disabled: !server.processes.some((process) => hasAccess(server._id, process._id)),
            }))}
            onChange={(values) => selectItem(values, "servers")}
            itemComponent={itemComponent}
            placeholder="Select Server"
            searchable
            withScrollArea
            maxDropdownHeight={240}
            comboboxProps={{ zIndex: 205 }}
          />
          <CustomMultiSelect
            label="Processes"
            aria-label="Select Process"
            data={servers.flatMap((server) =>
              server.processes
                .filter(() => selectedItem.servers.length === 0 || selectedItem.servers.includes(server._id))
                .map((process) => ({
                  value: process._id,
                  label: process.name,
                  status: process.status,
                  disabled: !hasAccess(server._id, process._id),
                })),
            )}
            value={selectedItem.processes}
            onChange={(values) => selectItem(values, "processes")}
            itemComponent={itemComponent}
            placeholder="Select Process"
            searchable
            withScrollArea
            maxValues={4}
            maxDropdownHeight={240}
            comboboxProps={{ zIndex: 205 }}
          />
          <Button onClick={close} size="md">
            Apply view
          </Button>
        </Stack>
      </Modal>
      <div className={classes.headerInner}>
        <div className={classes.headerBrand}>
          <WorkspaceBrand />
        </div>
        <div className={classes.headerIdentity}>
          {toggleMobile && (
            <Burger
              opened={mobileOpened}
              onClick={toggleMobile}
              aria-label="Toggle navigation"
              hiddenFrom="md"
              size="sm"
            />
          )}
          <div style={{ minWidth: 0 }}>
            <span className={classes.mobileEyebrow}>PM2 CONTROL</span>
            <h1 className={classes.pageTitle}>{page.title}</h1>
            <div className={classes.pageSubtitle}>
              {servers.length > 0 ? `${servers.length} servers · ${processCount} processes` : page.description}
            </div>
          </div>
        </div>
        {servers.length > 0 && (
          <div className={classes.headerControls}>
            <span className={classes.live}>
              <span className={`${classes.liveDot} ${isFresh ? "" : classes.delayedDot}`} />
              {isFresh ? "Live data" : "Updates delayed"}
            </span>
            {router.pathname !== "/process" && (
              <Button
                variant="light"
                leftSection={<IconFilterCog size={18} />}
                onClick={open}
                aria-label="Server/Process Filter"
                size="md"
              >
                Filters{" "}
                {selectionCount > 0 && (
                  <Badge size="sm" variant="filled" ml={8}>
                    {selectionCount}
                  </Badge>
                )}
              </Button>
            )}
          </div>
        )}
      </div>
    </AppShell.Header>
  );
}

function itemComponent(opt: IItem & { status: IProcess["status"] }) {
  return (
    <Flex align="center" gap="sm" miw={0}>
      {opt.disabled ? (
        <IconLock size={14} style={{ flexShrink: 0 }} />
      ) : (
        <IconCircleFilled
          size={9}
          color={opt.status === "online" ? "var(--ops-success)" : "var(--ops-muted)"}
          style={{ flexShrink: 0 }}
        />
      )}
      <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{opt.label}</span>
    </Flex>
  );
}
