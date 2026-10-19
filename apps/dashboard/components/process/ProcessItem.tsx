import { Paper, Stack, Text, Transition } from "@mantine/core";
import { IProcess, ISetting } from "@pm2.web/typings";
import { useId, useState } from "react";

import OperationHistory from "./OperationHistory";
import classes from "./Process.module.css";
import ProcessAction from "./ProcessActionRow";
import ProcessChart from "./ProcessChart";
import ProcessConfigForm from "./ProcessConfigForm";
import ProcessHeader from "./ProcessHeader";
import ProcessLog from "./ProcessLog";
import ProcessMetricRow from "./ProcessMetricRow";
import ProcessRuntimeDetails from "./ProcessRuntimeDetails";

interface ProcessItemProps {
  process: IProcess;
  setting: ISetting;
}

export default function ProcessItem({ process, setting }: ProcessItemProps) {
  const [collapsed, setCollapsed] = useState(true);
  const detailsId = useId();

  function getStatusColor() {
    switch (process.status) {
      case "online": {
        return "#12B886";
      }
      case "stopped": {
        return "#FCC419";
      }
      default: {
        return "#FA5252";
      }
    }
  }

  return (
    <Paper key={process._id} className={classes.card}>
      <Stack>
        <ProcessHeader
          statusColor={getStatusColor()}
          status={process.status}
          interpreter={process.type}
          name={process.name}
        />
        <div className={classes.summary}>
          <ProcessMetricRow
            process={process}
            refetchInterval={setting.polling.frontend}
            showMetric={process.status == "online"}
          />
          <ProcessAction
            process={process}
            collapse={() => setCollapsed(!collapsed)}
            expanded={!collapsed}
            detailsId={detailsId}
          />
        </div>
        <Transition transition="fade" duration={180} mounted={!collapsed}>
          {(styles) => (
            <div style={styles} className={classes.expanded} id={detailsId}>
              <div className={classes.configuration}>
                <Text size="sm" fw={600}>
                  Process details
                </Text>
                <ProcessConfigForm process={process} />
              </div>
              <ProcessRuntimeDetails runtime={process.runtime} />
              <OperationHistory processId={process._id} />
              <ProcessChart
                processId={process._id}
                refetchInterval={setting.polling.frontend}
                showMetric={process.status == "online"}
              />
              <ProcessLog processId={process._id} refetchInterval={setting.polling.frontend} />
            </div>
          )}
        </Transition>
      </Stack>
    </Paper>
  );
}
