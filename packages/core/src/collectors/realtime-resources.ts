import type { SshConnectionOptions } from "../models/ssh";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { parseMeminfo } from "../parsers/meminfo";
import { buildRealtimeResourcesCommand } from "../ssh/typed-commands";
import { executeSshCommand } from "../ssh/ssh-executor";
import type { RealtimeResources, RealtimeResourcesRaw } from "../models/resources";
import type { ProcessSummary } from "../models/overview";

interface CpuTotals {
  idle: number;
  total: number;
}

export async function collectRealtimeResources(
  platform: PlatformAdapter,
  hostAlias: string,
  timeoutMs = 5_000,
  connection?: SshConnectionOptions,
): Promise<{ result: RealtimeResources; durationMs: number }> {
  const execution = await executeSshCommand(platform, {
    hostAlias,
    command: buildRealtimeResourcesCommand(),
    timeoutMs,
    ...(connection ? { connection } : {}),
  });

  const raw = splitSections(execution.stdout);
  const warnings: string[] = [];

  if (execution.timedOut) {
    warnings.push("Realtime resource collection timed out before completion.");
  }
  if (execution.stderr) {
    warnings.push(execution.stderr);
  }

  const before = parseCpuTotals(raw.statBefore);
  const after = parseCpuTotals(raw.statAfter);

  return {
    durationMs: execution.durationMs,
    result: {
      cpu: {
        usagePercent: calculateCpuUsage(before, after),
        sampleWindowMs: 400,
      },
      memory: parseMeminfo(raw.meminfo),
      topProcess: parseRealtimeTopProcess(raw.topProcess),
      raw,
      warnings,
    },
  };
}

function splitSections(stdout: string): RealtimeResourcesRaw {
  const sections: Partial<Record<keyof RealtimeResourcesRaw, string[]>> = {};
  let currentSection: keyof RealtimeResourcesRaw | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const headerMatch = line.match(/^__PALA__(\w+)__$/);
    if (headerMatch) {
      currentSection = headerMatch[1] as keyof RealtimeResourcesRaw;
      sections[currentSection] = [];
      continue;
    }

    if (!currentSection) {
      continue;
    }

    sections[currentSection]?.push(line);
  }

  return {
    statBefore: joinSection(sections.statBefore),
    statAfter: joinSection(sections.statAfter),
    meminfo: joinSection(sections.meminfo),
    topProcess: joinSection(sections.topProcess),
  };
}

function joinSection(lines?: string[]): string {
  return (lines ?? []).join("\n").trim();
}

function parseCpuTotals(raw: string): CpuTotals {
  const parts = raw.trim().split(/\s+/);
  if (parts[0] !== "cpu") {
    return { idle: 0, total: 0 };
  }

  const values = parts.slice(1).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
  if (values.length === 0) {
    return { idle: 0, total: 0 };
  }

  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);

  return { idle, total };
}

function calculateCpuUsage(before: CpuTotals, after: CpuTotals): number {
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;

  if (totalDelta <= 0) {
    return 0;
  }

  const usagePercent = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.round(Math.max(0, Math.min(100, usagePercent)) * 100) / 100;
}

function parseRealtimeTopProcess(raw: string): ProcessSummary | null {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const [, ...dataLines] = lines;

  for (const line of dataLines) {
    const match = line.match(/^(\S+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    if (!match) {
      continue;
    }

    const user = match[1];
    const pid = match[2];
    const cpuPercent = match[3];
    const memoryPercent = match[4];
    const command = match[5];

    if (!user || !pid || !cpuPercent || !memoryPercent || !command) {
      continue;
    }

    return {
      user,
      pid: parseIntOrZero(pid),
      cpuPercent: parseFloatOrZero(cpuPercent),
      memoryPercent: parseFloatOrZero(memoryPercent),
      command,
    };
  }

  return null;
}

function parseFloatOrZero(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIntOrZero(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
