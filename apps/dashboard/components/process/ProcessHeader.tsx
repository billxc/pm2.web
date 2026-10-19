import { Text } from "@mantine/core";
import { IProcess } from "@pm2.web/typings";
import {
  IconBrandCSharp,
  IconBrandGolang,
  IconBrandJavascript,
  IconBrandPhp,
  IconBrandPowershell,
  IconBrandPython,
  IconCode,
  IconCoffee,
} from "@tabler/icons-react";
import { useCallback } from "react";

import classes from "./Process.module.css";

export default function ProcessHeader({
  statusColor,
  status,
  interpreter,
  name,
}: {
  statusColor?: string;
  status: IProcess["status"];
  interpreter: IProcess["type"];
  name: string;
}) {
  const InterpreterIcon = useCallback(() => {
    switch (interpreter) {
      case "node": {
        return <IconBrandJavascript size="1.6rem" stroke={1.5} color="#F0DB4F" />;
      }
      case "python": {
        return <IconBrandPython size="1.6rem" stroke={1.5} color="#3776AB" />;
      }
      case "php": {
        return <IconBrandPhp size="1.6rem" stroke={1.5} color="#8892BF" />;
      }
      case "bash": {
        return <IconBrandPowershell size="1.6rem" stroke={1.5} color="#5391FE" />;
      }
      case "go": {
        return <IconBrandGolang size="1.6rem" stroke={1.5} color="#00ADD8" />;
      }
      case "dotnet": {
        return <IconBrandCSharp size="1.6rem" stroke={1.5} color="#512BD4" />;
      }
      case "shell": {
        return <IconBrandPowershell size="1.6rem" stroke={1.5} color="#5391FE" />;
      }
      case "java": {
        return <IconCoffee size="1.6rem" stroke={1.5} color="#D5573B" />;
      }
      default: {
        return <IconCode size="1.6rem" stroke={1.5} color="#666666" />;
      }
    }
  }, [interpreter]);

  return (
    <div className={classes.header}>
      <div className={classes.interpreter} aria-hidden="true">
        <InterpreterIcon />
      </div>
      <div className={classes.identity}>
        <Text size="lg" fw={650} className={classes.name}>
          {name}
        </Text>
        <div className={classes.status}>
          <span className={classes.statusDot} style={{ background: statusColor || "gray" }} aria-hidden="true" />
          <span>{status}</span>
          <span aria-hidden="true">·</span>
          <span>{interpreter}</span>
        </div>
      </div>
    </div>
  );
}
