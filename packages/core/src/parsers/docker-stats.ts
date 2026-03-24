import type { ContainerStatsSnapshot } from "../models/container";

export function parseDockerStats(raw: string): ContainerStatsSnapshot[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [id, name, cpuText, memUsageText, memPercentText, netIoText, blockIoText, pidsText] = line.split("\t");
      if (!id || !name || !cpuText || !memUsageText || !memPercentText || !netIoText || !blockIoText || !pidsText) {
        return [];
      }

      const [memoryUsageBytes, memoryLimitBytes] = parseUsagePair(memUsageText);
      const [netInputBytes, netOutputBytes] = parseUsagePair(netIoText);
      const [blockInputBytes, blockOutputBytes] = parseUsagePair(blockIoText);

      return [{
        id,
        name,
        cpuPercent: parsePercent(cpuText),
        memoryUsageBytes,
        memoryLimitBytes,
        memoryPercent: parsePercent(memPercentText),
        netInputBytes,
        netOutputBytes,
        blockInputBytes,
        blockOutputBytes,
        pids: parseInteger(pidsText),
      }];
    });
}

function parseUsagePair(value: string): [number, number] {
  const [left = "", right = ""] = value.split("/");
  return [parseByteValue(left), parseByteValue(right)];
}

function parsePercent(value: string): number {
  const parsed = Number.parseFloat(value.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseByteValue(value: string): number {
  const normalized = value.trim().replace(/\s+/g, "");
  const match = normalized.match(/^([\d.]+)([KMGTP]?i?B)$/i);
  if (!match) {
    return 0;
  }

  const amount = Number.parseFloat(match[1] ?? "0");
  const unit = (match[2] ?? "B").toUpperCase();
  if (!Number.isFinite(amount)) {
    return 0;
  }

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1_000,
    MB: 1_000_000,
    GB: 1_000_000_000,
    TB: 1_000_000_000_000,
    KIB: 1_024,
    MIB: 1_048_576,
    GIB: 1_073_741_824,
    TIB: 1_099_511_627_776,
  };

  return Math.round(amount * (multipliers[unit] ?? 1));
}
