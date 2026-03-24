import type { FilesystemSummary } from "../models/overview";

const BYTES_PER_KIB = 1024;

export function parseDf(raw: string): FilesystemSummary[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const [, ...dataLines] = lines;

  return dataLines.flatMap((line) => {
    const match = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    if (!match) {
      return [];
    }

    const filesystem = match[1];
    const blocks = match[2];
    const used = match[3];
    const available = match[4];
    const usePercent = match[5];
    const mountPoint = match[6];

    if (!filesystem || !blocks || !used || !available || !usePercent || !mountPoint) {
      return [];
    }

    return [{
      filesystem,
      sizeBytes: toBytes(blocks),
      usedBytes: toBytes(used),
      availableBytes: toBytes(available),
      usedPercent: Number.parseInt(usePercent, 10),
      mountPoint,
    }];
  });
}

function toBytes(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed * BYTES_PER_KIB : 0;
}
