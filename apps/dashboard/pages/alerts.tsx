import { Stack, Text } from "@mantine/core";
import Head from "next/head";
import { useSession } from "next-auth/react";

import { AlertConfiguration } from "@/components/alerts/AlertConfiguration";
import { AlertList } from "@/components/alerts/AlertList";
import { Dashboard } from "@/components/layouts/Dashboard";

export default function AlertsPage() {
  const { data: session, status } = useSession();
  const canManage = !!(session?.user?.acl?.admin || session?.user?.acl?.owner);
  return (
    <>
      <Head>
        <title>告警 · pm2.web</title>
      </Head>
      <Dashboard>
        <Stack>
          {status === "authenticated" ? (
            <>
              <AlertList canManage={canManage} />
              {canManage && <AlertConfiguration />}
            </>
          ) : (
            <Text>{status === "loading" ? "正在加载…" : "请登录以查看告警。"}</Text>
          )}
        </Stack>
      </Dashboard>
    </>
  );
}
