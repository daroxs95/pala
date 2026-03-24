import type { SshConnectionOptions } from "../models/ssh";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { buildSshArgs } from "./ssh-connection";
import { closePersistentSshSession, executeWithPersistentSshSession } from "./persistent-ssh-session";

export interface ExecuteSshCommandOptions {
  hostAlias: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  connection?: SshConnectionOptions;
}

export interface SshExecutionResult {
  command: string;
  hostAlias: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export async function executeSshCommand(
  platform: PlatformAdapter,
  options: ExecuteSshCommandOptions,
): Promise<SshExecutionResult> {
  if ((options.connection?.mode ?? "stateless") === "persistent") {
    const execution = await executeWithPersistentSshSession(
      platform,
      options.hostAlias,
      options.command,
      options.timeoutMs ?? 10_000,
      options.connection?.connectTimeoutSeconds ?? 5,
    );

    return {
      command: options.command,
      hostAlias: options.hostAlias,
      exitCode: execution.exitCode,
      stdout: execution.stdout.trim(),
      stderr: execution.stderr.trim(),
      timedOut: false,
      durationMs: execution.durationMs,
    };
  }

  const startedAt = Date.now();
  const args = await buildSshArgs(options.hostAlias, [options.command], options.connection);
  const sshProcess = platform.spawn(platform.getSshBinary(), args);

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const onAbort = () => {
    sshProcess.kill();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      sshProcess.kill();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    sshProcess.kill();
  }, options.timeoutMs ?? 10_000);

  return await new Promise<SshExecutionResult>((resolve, reject) => {
    sshProcess.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    sshProcess.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    sshProcess.once("error", (error) => {
      cleanup();
      reject(error);
    });

    sshProcess.once("close", (exitCode) => {
      cleanup();
      resolve({
        command: options.command,
        hostAlias: options.hostAlias,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });

  function cleanup(): void {
    clearTimeout(timeout);
    if (options.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
}

export async function closeSshConnection(
  platform: PlatformAdapter,
  hostAlias: string,
  connection?: SshConnectionOptions,
): Promise<void> {
  if ((connection?.mode ?? "stateless") !== "persistent") {
    return;
  }

  await closePersistentSshSession(platform, hostAlias);
}
