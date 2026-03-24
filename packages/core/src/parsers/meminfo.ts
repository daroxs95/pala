import type { MemorySummary } from "../models/overview";

const BYTES_PER_KIB = 1024;

export function parseMeminfo(raw: string): MemorySummary {
  const values = new Map<string, number>();

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2];
    if (!key || !value) {
      continue;
    }

    values.set(key, Number.parseInt(value, 10) * BYTES_PER_KIB);
  }

  const totalBytes = values.get("MemTotal") ?? 0;
  const freeBytes = values.get("MemFree") ?? 0;
  const availableBytes = values.get("MemAvailable") ?? freeBytes;
  const buffersBytes = values.get("Buffers") ?? 0;
  const cachedBytes = values.get("Cached") ?? 0;
  const usedBytes = Math.max(totalBytes - availableBytes, 0);
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  return {
    totalBytes,
    freeBytes,
    availableBytes,
    buffersBytes,
    cachedBytes,
    usedBytes,
    usedPercent: round(usedPercent),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
