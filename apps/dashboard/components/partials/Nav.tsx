import { AppShell, Drawer, UnstyledButton, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBell,
  IconGauge,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconMoonStars,
  IconSettings,
  IconSun,
  IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Session } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";

import classes from "../layouts/Dashboard.module.css";
import { WorkspaceBrand } from "./WorkspaceBrand";

const navLinks = [
  { icon: IconGauge, label: "Overview", href: "/" },
  { icon: IconLayoutDashboard, label: "Process", href: "/process" },
  { icon: IconHistory, label: "Operations", href: "/operations" },
  { icon: IconBell, label: "Alerts", href: "/alerts" },
  {
    icon: IconUser,
    label: "User Administration",
    href: "/user",
    onlyIf: (session: Session | null) => session?.user?.acl?.admin || session?.user?.acl?.owner,
  },
  { icon: IconSettings, label: "Settings", href: "/settings" },
];

function Navigation({ onNavigate }: { onNavigate: () => void }) {
  const { data: session } = useSession();
  const router = useRouter();
  const scheme = useComputedColorScheme("light");
  const { setColorScheme } = useMantineColorScheme();
  return (
    <div className={classes.navigation}>
      <div>
        <p className={classes.sectionLabel}>Workspace</p>
        <div className={classes.navList}>
          {navLinks
            .filter((link) => !link.onlyIf || link.onlyIf(session))
            .map(({ icon: Icon, label, href }) => (
              <UnstyledButton
                key={href}
                component={Link}
                href={href}
                onClick={onNavigate}
                className={classes.navLink}
                data-active={router.pathname === href || undefined}
                aria-current={router.pathname === href ? "page" : undefined}
              >
                <Icon size={20} stroke={1.7} />
                <span className={classes.navLabel}>{label}</span>
                {router.pathname === href && <span className={classes.navDot} />}
              </UnstyledButton>
            ))}
        </div>
      </div>
      <div className={classes.navFooter}>
        <UnstyledButton
          className={classes.navLink}
          aria-label="Toggle Theme"
          onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}
          w="100%"
        >
          <IconSun size={20} stroke={1.7} className={classes.lightAppearanceIcon} />
          <IconMoonStars size={20} stroke={1.7} className={classes.darkAppearanceIcon} />
          <span className={classes.navLabel}>Switch appearance</span>
        </UnstyledButton>
        {!session?.authDisabled && (
          <UnstyledButton className={classes.navLink} onClick={() => signOut()} w="100%">
            <IconLogout size={20} stroke={1.7} />
            <span className={classes.navLabel}>Logout</span>
          </UnstyledButton>
        )}
        <div className={classes.workspaceHint}>
          <strong>PM2 Control</strong>Self-hosted process workspace
        </div>
      </div>
    </div>
  );
}

export function Nav({ mobileOpened, onNavigate }: { mobileOpened: boolean; onNavigate: () => void }) {
  const router = useRouter();
  const isDesktop = useMediaQuery("(min-width: 62em)");
  useEffect(() => {
    if (isDesktop) onNavigate();
  }, [isDesktop, onNavigate]);
  return (
    <>
      <AppShell.Navbar p="md" visibleFrom="md" className={classes.sidebar} aria-label="Desktop navigation">
        <Navigation onNavigate={onNavigate} />
      </AppShell.Navbar>
      <Drawer
        opened={mobileOpened && !isDesktop}
        onClose={onNavigate}
        hiddenFrom="md"
        title={<WorkspaceBrand onNavigate={onNavigate} />}
        size={286}
        styles={{
          content: { display: "flex", flexDirection: "column" },
          body: { flex: 1, minHeight: 0, overflowY: "auto" },
        }}
      >
        <Navigation onNavigate={onNavigate} />
      </Drawer>
      <nav className={classes.bottomNav} aria-label="Mobile main navigation">
        {navLinks.slice(0, 4).map(({ icon: Icon, label, href }) => (
          <Link
            href={href}
            key={href}
            className={classes.bottomLink}
            data-active={router.pathname === href || undefined}
            aria-current={router.pathname === href ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={22} stroke={1.7} />
            <span className={classes.bottomLabel}>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
