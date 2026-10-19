import Image from "next/image";
import Link from "next/link";

import classes from "../layouts/Dashboard.module.css";

export function WorkspaceBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/" className={classes.brand} aria-label="PM2 Control home" onClick={onNavigate}>
      <span className={classes.brandLogo}>
        <Image alt="" src="/logo.png" width={26} height={26} />
      </span>
      <span>
        <span className={classes.brandName}>PM2 Control</span>
        <span className={classes.brandCaption}>Runtime workspace</span>
      </span>
    </Link>
  );
}
