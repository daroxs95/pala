import { spawn as spawnPty } from "node-pty";
import type { EventEmitter } from "node:events";

import type { SshConnectionOptions } from "../models/ssh";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { buildSshArgs } from "./ssh-connection";
import { writeSshDebugLog } from "./ssh-debug-log";

export interface PtySshExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export async function executeWithPasswordPty(
  platform: PlatformAdapter,
  hostAlias: string,
  command: string,
  timeoutMs: number,
  connection: SshConnectionOptions,
  signal?: AbortSignal,
): Promise<PtySshExecutionResult> {
  if (!connection.password) {
    throw new Error("Password is required for PTY SSH execution.");
  }

  const startedAt = Date.now();
  const args = await buildSshArgs(hostAlias, [command], connection);
  await writeSshDebugLog({
    event: "pty-spawn",
    hostAlias,
    sshBinary: platform.getSshBinary(),
    args,
    remoteCommand: command,
    connection,
  });
  const ptyProcess = spawnPty(platform.getSshBinary(), args, {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: "xterm-color",
    },
    encoding: "utf8",
  });

  let combinedOutput = "";
  let passwordSent = false;
  let timedOut = false;
  let closed = false;

  const onAbort = () => {
    ptyProcess.kill();
  };

  if (signal) {
    if (signal.aborted) {
      ptyProcess.kill();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    closed = true;
    ptyProcess.kill();
  }, timeoutMs);

  return await new Promise<PtySshExecutionResult>((resolve) => {
    const ptyEventEmitter = ptyProcess as unknown as EventEmitter;
    const onPtyError = (error: unknown) => {
      closed = true;
      void writeSshDebugLog({
        event: "pty-error",
        hostAlias,
        remoteCommand: command,
        connection,
        note: error instanceof Error ? error.message : String(error),
      });
    };
    ptyEventEmitter.on("error", onPtyError);

    const dataDisposable = ptyProcess.onData((chunk) => {
      combinedOutput += chunk;

      const tail = stripAnsi(combinedOutput.slice(-512));
      if (!passwordSent && /password:\s*$/i.test(tail)) {
        sendPassword("pty-password-prompt-detected", "Detected password prompt and sent password through PTY.");
        return;
      }

      if (!passwordSent) {
        sendPassword(
          "pty-password-send-on-first-output",
          "Received initial PTY output without a visible prompt; sent password immediately.",
        );
      }
    });

    const exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      closed = true;
      cleanup();
      const output = normalizePtyOutput(combinedOutput);
      resolve({
        exitCode,
        stdout: exitCode === 0 ? output : "",
        stderr: exitCode === 0 ? "" : output,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    function cleanup(): void {
      clearTimeout(timeout);
      dataDisposable.dispose();
      exitDisposable.dispose();
      ptyEventEmitter.off("error", onPtyError);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }

    function sendPassword(event: string, note: string): void {
      if (passwordSent || closed) {
        return;
      }

      passwordSent = true;
      void writeSshDebugLog({
        event,
        hostAlias,
        remoteCommand: command,
        connection,
        note,
      });

      try {
        ptyProcess.write(`${connection.password}\r`);
      } catch (error) {
        void writeSshDebugLog({
          event: "pty-password-write-error",
          hostAlias,
          remoteCommand: command,
          connection,
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}

function normalizePtyOutput(value: string): string {
  return stripAnsi(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\n]*password:\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}
