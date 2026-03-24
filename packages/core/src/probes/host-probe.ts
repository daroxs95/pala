import type { SshConnectionOptions } from "../models/ssh";
import type { HostProbeResult } from "../models/capabilities";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { buildProbeCommand } from "../ssh/typed-commands";
import { executeSshCommand } from "../ssh/ssh-executor";

export async function probeHost(
  platform: PlatformAdapter,
  hostAlias: string,
  timeoutMs = 10_000,
  connection?: SshConnectionOptions,
): Promise<{ result: HostProbeResult; durationMs: number }> {
  const execution = await executeSshCommand(platform, {
    hostAlias,
    command: buildProbeCommand(),
    timeoutMs,
    ...(connection ? { connection } : {}),
  });

  const warnings: string[] = [];
  if (execution.timedOut) {
    warnings.push("Probe timed out before completion.");
  }
  if (execution.stderr) {
    warnings.push(execution.stderr);
  }

  const values = parseKeyValueOutput(execution.stdout);
  const shell = values.shell === "1";

  return {
    durationMs: execution.durationMs,
    result: {
      reachable: execution.exitCode === 0 && !execution.timedOut,
      shell,
      capabilities: {
        procfs: values.procfs === "1",
        docker: values.docker === "1",
        systemd: values.systemd === "1",
        journalctl: values.journalctl === "1",
        socketStats: values.socketStats === "1",
      },
      raw: {
        stdout: execution.stdout,
        stderr: execution.stderr,
      },
      warnings,
    },
  };
}

function parseKeyValueOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of output.split(/\r?\n/)) {
    const [key, value] = line.split("=", 2);
    if (key && value) {
      values[key.trim()] = value.trim();
    }
  }

  return values;
}
