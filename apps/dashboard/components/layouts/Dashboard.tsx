import { AppShell, Container } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ReactNode } from "react";

import { Head } from "../partials/Head";
import { Nav } from "../partials/Nav";

export function Dashboard({ children }: { children: ReactNode }) {
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 80, breakpoint: "sm", collapsed: { mobile: !mobileOpened } }}
      padding={{ base: "xs", sm: "xl" }}
      bg="var(--mantine-color-body)"
    >
      <Head mobileOpened={mobileOpened} toggleMobile={toggleMobile} />
      <Nav onNavigate={closeMobile} />
      <AppShell.Main display="flex" style={{ flexDirection: "column", minHeight: "100vh" }}>
        <Container
          size="xl"
          w="100%"
          px={{ base: 0, sm: "md" }}
          flex={1}
          display="flex"
          style={{ flexDirection: "column", minWidth: 0 }}
        >
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
