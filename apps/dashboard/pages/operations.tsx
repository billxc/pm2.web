import { Accordion, Alert, Button, Select, Stack, Text } from "@mantine/core";
import Head from "next/head";
import { useSession } from "next-auth/react";
import { useState } from "react";

import { Dashboard } from "@/components/layouts/Dashboard";
import OperationHistory, { OperationStatus } from "@/components/process/OperationHistory";
import styles from "@/pages/PageVisuals.module.css";
import { getServerSideHelpers } from "@/server/helpers";
import { trpc } from "@/utils/trpc";

export default function OperationsPage() {
  const { data: session } = useSession();
  const [serverId, setServerId] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string>();
  const dashboard = trpc.server.getDashBoardData.useQuery();
  const save = trpc.operations.enqueue.useMutation({ onSuccess: (operation) => setOperationId(operation._id) });
  const isAdmin = session?.user?.acl?.admin || session?.user?.acl?.owner;
  return (
    <>
      <Head>
        <title>Operations · pm2.web</title>
      </Head>
      <Dashboard>
        <Stack className={styles.page}>
          <Select
            className={styles.filter}
            label="Server"
            placeholder="All servers"
            clearable
            value={serverId}
            onChange={setServerId}
            data={dashboard.data?.servers.map((server) => ({ value: server._id, label: server.name })) || []}
          />
          {save.error && <Alert color="red">{save.error.message}</Alert>}
          {operationId && <OperationStatus id={operationId} />}
          <OperationHistory serverId={serverId || undefined} />
          <Text size="xs" className={styles.muted}>
            Tasks survive page reloads. Queued tasks expire after 10 minutes without execution. After a backend restart,
            unfinished running tasks become unknown: inspect PM2 and manually decide what to do. Tasks are never
            automatically replayed. Configuration/environment payloads are not shown in history.
          </Text>
          {isAdmin && (
            <Accordion variant="contained" className={styles.secondary} keepMounted keepMountedMode="display-none">
              <Accordion.Item value="startup-save" style={{ border: 0, background: "transparent" }}>
                <Accordion.Control className={styles.disclosure}>Server startup list · explicit save</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="md">
                    <Alert color="yellow">
                      Save writes the entire selected server's current PM2 app list, including other apps. Stopped apps
                      are saved with autostart=false. It does not install an OS boot service; PM2 startup/resurrect must
                      already be configured locally.
                    </Alert>
                    <Button
                      disabled={!serverId}
                      loading={save.isPending}
                      onClick={() => {
                        if (
                          serverId &&
                          window.confirm(
                            "Save the entire current PM2 app list on this server for future resurrection? This can overwrite the previous saved list, including an empty list.",
                          )
                        )
                          save.mutate({ serverId, action: "save", saveStartup: false });
                      }}
                    >
                      Explicitly save server startup list
                    </Button>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </Stack>
      </Dashboard>
    </>
  );
}

export async function getServerSideProps() {
  const helpers = await getServerSideHelpers();
  await helpers.server.getDashBoardData.prefetch();
  return { props: { trpcState: helpers.dehydrate() } };
}
