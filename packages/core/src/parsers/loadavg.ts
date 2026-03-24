import type { CpuSummary } from "../models/overview";

export function parseLoadAverage(raw: string): CpuSummary {
  const [load1, load5, load15, processSummary, lastPidText] = raw.trim().split(/\s+/);
  const [runningText = "0", totalText = "0"] = (processSummary ?? "0/0").split("/");

  return {
    loadAverage1m: parseFloatOrZero(load1),
    loadAverage5m: parseFloatOrZero(load5),
    loadAverage15m: parseFloatOrZero(load15),
    runningProcesses: parseIntOrZero(runningText),
    totalProcesses: parseIntOrZero(totalText),
    lastPid: parseIntOrZero(lastPidText),
  };
}

function parseFloatOrZero(value?: string): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIntOrZero(value?: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

