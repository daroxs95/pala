import type { ContainerStatsResult } from "../models/container";
import type { SshConnectionOptions } from "../models/ssh";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { parseDockerStats } from "../parsers/docker-stats";
import { executeSshCommand } from "../ssh/ssh-executor";
import { buildDockerStatsCommand } from "../ssh/typed-commands";

export async function getContainerStats(
  platform: PlatformAdapter,
  hostAlias: string,
  timeoutMs = 20_000,
  connection?: SshConnectionOptions,
): Promise<{ result: ContainerStatsResult; durationMs: number }> {
  const execution = await executeSshCommand(platform, {
    hostAlias,
    command: buildDockerStatsCommand(),
    timeoutMs,
    ...(connection ? { connection } : {}),
  });

  const warnings: string[] = [];
  if (execution.timedOut) {
    warnings.push("Container stats collection timed out before completion.");
  }
  if (execution.stderr) {
    warnings.push(execution.stderr);
  }

  const dockerAvailable = !/__PALA_DOCKER_MISSING__/i.test(execution.stdout);
  const stdout = dockerAvailable
    ? execution.stdout
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "__PALA_DOCKER_OK__")
        .join("\n")
        .trim()
    : "";

  return {
    durationMs: execution.durationMs,
    result: {
      dockerAvailable,
      stats: dockerAvailable ? parseDockerStats(stdout) : [],
      raw: {
        stdout,
        stderr: execution.stderr,
      },
      warnings,
    },
  };
}
