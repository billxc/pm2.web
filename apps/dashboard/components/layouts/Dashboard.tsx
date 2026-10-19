import { AppShell, Container } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ReactNode } from "react";

import { Head } from "../partials/Head";
import { Nav } from "../partials/Nav";
import classes from "./Dashboard.module.css";

export function Dashboard({ children }: { children: ReactNode }) {
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  return (
    <AppShell
      header={{ height: { base: 72, md: 84 } }}
      navbar={{ width: 240, breakpoint: "md", collapsed: { mobile: true } }}
      padding={{ base: "md", md: 28 }}
      className={classes.shell}
    >
      <Head mobileOpened={mobileOpened} toggleMobile={toggleMobile} />
      <Nav mobileOpened={mobileOpened} onNavigate={closeMobile} />
      <AppShell.Main className={classes.main}>
        <Container size={1600} px={0} className={classes.workspace}>
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
