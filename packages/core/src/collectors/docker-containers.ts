import type { ContainerListResult } from "../models/container";
import type { SshConnectionOptions } from "../models/ssh";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { parseDockerPs } from "../parsers/docker-ps";
import { executeSshCommand } from "../ssh/ssh-executor";
import { buildDockerListContainersCommand } from "../ssh/typed-commands";

export async function listContainers(
  platform: PlatformAdapter,
  hostAlias: string,
  timeoutMs = 20_000,
  connection?: SshConnectionOptions,
): Promise<{ result: ContainerListResult; durationMs: number }> {
  const execution = await executeSshCommand(platform, {
    hostAlias,
    command: buildDockerListContainersCommand(),
    timeoutMs,
    ...(connection ? { connection } : {}),
  });

  const warnings: string[] = [];
  if (execution.timedOut) {
    warnings.push("Container listing timed out before completion.");
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
      containers: dockerAvailable ? parseDockerPs(stdout) : [],
      raw: {
        stdout,
        stderr: execution.stderr,
      },
      warnings,
    },
  };
}

