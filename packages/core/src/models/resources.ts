import type { MemorySummary, ProcessSummary } from "./overview";

export interface RealtimeCpuSummary {
  usagePercent: number;
  sampleWindowMs: number;
}

export interface RealtimeResourcesRaw {
  statBefore: string;
  statAfter: string;
  meminfo: string;
  topProcess: string;
}

export interface RealtimeResources {
  cpu: RealtimeCpuSummary;
  memory: MemorySummary;
  topProcess: ProcessSummary | null;
  raw: RealtimeResourcesRaw;
  warnings: string[];
}
