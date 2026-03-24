export interface HostSummary {
  hostname: string;
  kernel: string;
  uptimeText: string;
}

export interface CpuSummary {
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  runningProcesses: number;
  totalProcesses: number;
  lastPid: number;
}

export interface MemorySummary {
  totalBytes: number;
  freeBytes: number;
  availableBytes: number;
  buffersBytes: number;
  cachedBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface FilesystemSummary {
  filesystem: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  mountPoint: string;
}

export interface ProcessSummary {
  user: string;
  pid: number;
  cpuPercent: number;
  memoryPercent: number;
  command: string;
}

export interface SystemOverviewRaw {
  hostname: string;
  uname: string;
  uptime: string;
  loadavg: string;
  meminfo: string;
  df: string;
  ps: string;
}

export interface SystemOverview {
  host: HostSummary;
  cpu: CpuSummary;
  memory: MemorySummary;
  filesystems: FilesystemSummary[];
  topProcesses: ProcessSummary[];
  raw: SystemOverviewRaw;
  warnings: string[];
}

