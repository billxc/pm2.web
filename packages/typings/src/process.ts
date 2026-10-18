type ILogType = "success" | "error" | "warning" | "info";

interface ILog {
  type: ILogType;
  message: string;
  createdAt: Date;
  _id: string;
}

const PROCESS_TYPES = <const>[
  "node",
  "python",
  "ruby",
  "php",
  "bash",
  "go",
  "dotnet",
  "shell",
  "java",
  "other",
];

type IProcessType = (typeof PROCESS_TYPES)[number];

type IProcessStatus =
  | "online"
  | "stopping"
  | "stopped"
  | "launching"
  | "errored"
  | "offline"
  | "one-launch-status";

interface IProcessRuntime {
  command?: string;
  script?: string;
  cwd?: string;
  interpreter?: string;
  pid?: number;
  mode?: string;
  restarts?: number;
  platform?: string;
  exitCode?: number;
  unstableRestarts?: number;
}

interface IProcess {
  _id: string;
  pm_id: number;
  server: string;
  name: string;
  type: IProcessType;
  logs?: ILog[];
  status: IProcessStatus;
  runtime?: IProcessRuntime;
  versioning: {
    url?: string;
    revision?: string;
    comment?: string;
    branch?: string;
    unstaged?: boolean;
  };
  createdAt?: string;
  updatedAt: string;
}

type IProcessModel = IProcess;

export type {
  ILog,
  ILogType,
  IProcessType,
  IProcessStatus,
  IProcessRuntime,
  IProcess,
  IProcessModel,
};

export { PROCESS_TYPES };
