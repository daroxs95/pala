import type { HostProbeResult } from "../models/capabilities";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { executeSshCommand } from "../ssh/ssh-executor";

const PROBE_COMMAND = [
  "printf 'shell=1\\n'",
  "if [ -d /proc ]; then printf 'procfs=1\\n'; else printf 'procfs=0\\n'; fi",
  "if command -v docker >/dev/null 2>&1; then printf 'docker=1\\n'; else printf 'docker=0\\n'; fi",
  "if command -v systemctl >/dev/null 2>&1; then printf 'systemd=1\\n'; else printf 'systemd=0\\n'; fi",
  "if command -v journalctl >/dev/null 2>&1; then printf 'journalctl=1\\n'; else printf 'journalctl=0\\n'; fi",
  "if command -v ss >/dev/null 2>&1; then printf 'socketStats=1\\n'; else printf 'socketStats=0\\n'; fi",
].join("; ");

export async function probeHost(
  platform: PlatformAdapter,
  hostAlias: string,
  timeoutMs = 10_000,
): Promise<{ result: HostProbeResult; durationMs: number }> {
  const execution = await executeSshCommand(platform, {
    hostAlias,
    command: PROBE_COMMAND,
    timeoutMs,
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

