import { randomUUID } from "node:crypto";

import { AppError } from "../errors/app-error";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { buildSshArgs } from "./ssh-connection";

interface PendingCommand {
  token: string;
  command: string;
  startedAt: number;
  timeout: NodeJS.Timeout;
  stdout: string;
  stderr: string;
  resolve: (value: {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }) => void;
  reject: (error: unknown) => void;
}

interface QueuedCommand {
  start: () => void;
  reject: (error: unknown) => void;
}

class PersistentSshSession {
  private readonly sshProcess;
  private readonly queue: QueuedCommand[] = [];
  private current: PendingCommand | undefined;
  private stdoutBuffer = "";
  private closed = false;

  constructor(
    private readonly platform: PlatformAdapter,
    private readonly hostAlias: string,
    private readonly connectTimeoutSeconds: number,
  ) {
    this.sshProcess = platform.spawn(
      platform.getSshBinary(),
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        `ConnectTimeout=${connectTimeoutSeconds}`,
        hostAlias,
        "sh",
      ],
    );

    this.sshProcess.stdout.on("data", (chunk: Buffer | string) => {
      this.handleStdoutChunk(chunk.toString());
    });

    this.sshProcess.stderr.on("data", (chunk: Buffer | string) => {
      if (this.current) {
        this.current.stderr += chunk.toString();
      }
    });

    this.sshProcess.once("error", (error) => {
      this.failCurrentAndPending(error);
      this.closed = true;
    });

    this.sshProcess.once("close", (exitCode) => {
      const error = new AppError(
        "SSH_SESSION_CLOSED",
        "Persistent SSH session closed unexpectedly.",
        { hostAlias, exitCode },
      );
      this.failCurrentAndPending(error);
      this.closed = true;
    });
  }

  execute(command: string, timeoutMs: number): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }> {
    if (this.closed) {
      return Promise.reject(new AppError(
        "SSH_SESSION_CLOSED",
        "Persistent SSH session is already closed.",
        { hostAlias: this.hostAlias },
      ));
    }

    return new Promise((resolve, reject) => {
      const run = () => {
        const token = randomUUID();
        const timeout = setTimeout(() => {
          this.current = undefined;
          this.closed = true;
          this.sshProcess.kill();
          reject(new AppError(
            "SSH_TIMEOUT",
            "Timed out while waiting for persistent SSH command to complete.",
            { hostAlias: this.hostAlias, command, timeoutMs },
          ));
          this.runNext();
        }, timeoutMs);

        this.current = {
          token,
          command,
          startedAt: Date.now(),
          timeout,
          stdout: "",
          stderr: "",
          resolve,
          reject,
        };

        const wrappedCommand = `${command}\nprintf '__PALA_EXIT_${token}__=%s\\n' "$?"\n`;

        this.sshProcess.stdin.write(wrappedCommand);
      };

      if (this.current) {
        this.queue.push({ start: run, reject });
      } else {
        run();
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.sshProcess.stdin.end("exit\n");

    await new Promise<void>((resolve) => {
      this.sshProcess.once("close", () => resolve());
      setTimeout(() => {
        this.sshProcess.kill();
        resolve();
      }, 1_000);
    });
  }

  private handleStdoutChunk(chunk: string): void {
    if (!this.current) {
      return;
    }

    this.stdoutBuffer += chunk;
    const marker = `__PALA_EXIT_${this.current.token}__=`;
    const markerIndex = this.stdoutBuffer.indexOf(marker);
    if (markerIndex < 0) {
      return;
    }

    const beforeMarker = this.stdoutBuffer.slice(0, markerIndex);
    const afterMarker = this.stdoutBuffer.slice(markerIndex + marker.length);
    const newlineIndex = afterMarker.indexOf("\n");
    if (newlineIndex < 0) {
      return;
    }

    const exitCodeText = afterMarker.slice(0, newlineIndex).trim();
    const remainder = afterMarker.slice(newlineIndex + 1);
    const pending = this.current;
    this.current = undefined;
    clearTimeout(pending.timeout);

    pending.stdout += beforeMarker.trim();
    this.stdoutBuffer = remainder;
    pending.resolve({
      exitCode: Number.parseInt(exitCodeText, 10) || 0,
      stdout: pending.stdout,
      stderr: pending.stderr.trim(),
      durationMs: Date.now() - pending.startedAt,
    });

    this.runNext();
  }

  private runNext(): void {
    const next = this.queue.shift();
    if (next) {
      next.start();
    }
  }

  private failCurrentAndPending(error: unknown): void {
    if (this.current) {
      clearTimeout(this.current.timeout);
      this.current.reject(error);
      this.current = undefined;
    }

    while (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.reject(error);
    }
  }
}

const sessionPool = new Map<string, PersistentSshSession>();

export async function executeWithPersistentSshSession(
  platform: PlatformAdapter,
  hostAlias: string,
  command: string,
  timeoutMs: number,
  connectTimeoutSeconds: number,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const sessionKey = `${platform.getSshBinary()}::${hostAlias}`;
  let session = sessionPool.get(sessionKey);
  if (!session) {
    session = new PersistentSshSession(platform, hostAlias, connectTimeoutSeconds);
    sessionPool.set(sessionKey, session);
  }

  try {
    return await session.execute(command, timeoutMs);
  } catch (error) {
    sessionPool.delete(sessionKey);
    throw error;
  }
}

export async function closePersistentSshSession(
  platform: PlatformAdapter,
  hostAlias: string,
): Promise<void> {
  const sessionKey = `${platform.getSshBinary()}::${hostAlias}`;
  const session = sessionPool.get(sessionKey);
  if (!session) {
    return;
  }

  sessionPool.delete(sessionKey);
  await session.close();
}
