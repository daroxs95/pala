import type { ProcessSummary } from "../models/overview";

export function parsePs(raw: string, limit = 5): ProcessSummary[] {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const [, ...dataLines] = lines;

  return dataLines
    .flatMap((line) => {
      const match = line.match(/^(\S+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
      if (!match) {
        return [];
      }

      const user = match[1];
      const pid = match[2];
      const cpuPercent = match[3];
      const memoryPercent = match[4];
      const command = match[5];

      if (!user || !pid || !cpuPercent || !memoryPercent || !command) {
        return [];
      }

      return [{
        user,
        pid: parseIntOrZero(pid),
        cpuPercent: parseFloatOrZero(cpuPercent),
        memoryPercent: parseFloatOrZero(memoryPercent),
        command,
      }];
    })
    .sort((left, right) => right.cpuPercent - left.cpuPercent)
    .slice(0, limit);
}

function parseFloatOrZero(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIntOrZero(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
