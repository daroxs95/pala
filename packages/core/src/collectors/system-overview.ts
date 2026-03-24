import type { SshConnectionOptions } from "../models/ssh";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { parseDf } from "../parsers/df";
import { parseLoadAverage } from "../parsers/loadavg";
import { parseMeminfo } from "../parsers/meminfo";
import { parsePs } from "../parsers/ps";
import { buildSystemOverviewCommand } from "../ssh/typed-commands";
import { executeSshCommand } from "../ssh/ssh-executor";
import type { SystemOverview, SystemOverviewRaw } from "../models/overview";

export async function collectSystemOverview(
  platform: PlatformAdapter,
  hostAlias: string,
  timeoutMs = 30_000,
  connection?: SshConnectionOptions,
): Promise<{ result: SystemOverview; durationMs: number }> {
  const execution = await executeSshCommand(platform, {
    hostAlias,
    command: buildSystemOverviewCommand(),
    timeoutMs,
    ...(connection ? { connection } : {}),
  });

  const raw = splitSections(execution.stdout);
  const warnings: string[] = [];

  if (execution.timedOut) {
    warnings.push("Overview collection timed out before completion.");
  }
  if (execution.stderr) {
    warnings.push(execution.stderr);
  }

  const host = {
    hostname: raw.hostname.trim(),
    kernel: raw.uname.trim(),
    uptimeText: raw.uptime.trim(),
  };
  const cpu = parseLoadAverage(raw.loadavg);
  const memory = parseMeminfo(raw.meminfo);
  const filesystems = parseDf(raw.df);
  const topProcesses = parsePs(raw.ps);

  return {
    durationMs: execution.durationMs,
    result: {
      host,
      cpu,
      memory,
      filesystems,
      topProcesses,
      raw,
      warnings,
    },
  };
}

function splitSections(stdout: string): SystemOverviewRaw {
  const sections: Partial<Record<keyof SystemOverviewRaw, string[]>> = {};
  let currentSection: keyof SystemOverviewRaw | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const headerMatch = line.match(/^__PALA__(\w+)__$/);
    if (headerMatch) {
      currentSection = headerMatch[1] as keyof SystemOverviewRaw;
      sections[currentSection] = [];
      continue;
    }

    if (!currentSection) {
      continue;
    }

    sections[currentSection]?.push(line);
  }

  return {
    hostname: joinSection(sections.hostname),
    uname: joinSection(sections.uname),
    uptime: joinSection(sections.uptime),
    loadavg: joinSection(sections.loadavg),
    meminfo: joinSection(sections.meminfo),
    df: joinSection(sections.df),
    ps: joinSection(sections.ps),
  };
}

function joinSection(lines?: string[]): string {
  return (lines ?? []).join("\n").trim();
}
