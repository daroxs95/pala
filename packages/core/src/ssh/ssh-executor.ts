import type { PlatformAdapter } from "../platform/platform-adapter";

export interface ExecuteSshCommandOptions {
  hostAlias: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
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
  const startedAt = Date.now();
  const sshProcess = platform.spawn(platform.getSshBinary(), [
    options.hostAlias,
    options.command,
  ]);

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

