export interface ContainerPortBinding {
  raw: string;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: ContainerPortBinding[];
}

export interface ContainerListResult {
  dockerAvailable: boolean;
  containers: ContainerSummary[];
  raw: {
    stdout: string;
    stderr: string;
  };
  warnings: string[];
}

export interface ContainerStatsSnapshot {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  netInputBytes: number;
  netOutputBytes: number;
  blockInputBytes: number;
  blockOutputBytes: number;
  pids: number;
}

export interface ContainerStatsResult {
  dockerAvailable: boolean;
  stats: ContainerStatsSnapshot[];
  raw: {
    stdout: string;
    stderr: string;
  };
  warnings: string[];
}
