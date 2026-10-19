import { Accordion, Stack, Text } from "@mantine/core";
import Head from "next/head";
import { useSession } from "next-auth/react";

import { AlertConfiguration } from "@/components/alerts/AlertConfiguration";
import { AlertList } from "@/components/alerts/AlertList";
import { Dashboard } from "@/components/layouts/Dashboard";
import styles from "@/pages/PageVisuals.module.css";

export default function AlertsPage() {
  const { data: session, status } = useSession();
  const canManage = !!(session?.user?.acl?.admin || session?.user?.acl?.owner);
  return (
    <>
      <Head>
        <title>告警 · pm2.web</title>
      </Head>
      <Dashboard>
        <Stack className={styles.page}>
          {status === "authenticated" ? (
            <>
              <AlertList canManage={canManage} />
              {canManage && (
                <Accordion variant="contained" className={styles.secondary} keepMounted keepMountedMode="display-none">
                  <Accordion.Item value="configuration" style={{ border: 0, background: "transparent" }}>
                    <Accordion.Control className={styles.disclosure}>告警配置 · 管理员 / 所有者</Accordion.Control>
                    <Accordion.Panel>
                      <AlertConfiguration />
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
            </>
          ) : (
            <Text>{status === "loading" ? "正在加载…" : "请登录以查看告警。"}</Text>
          )}
        </Stack>
      </Dashboard>
    </>
  );
}
