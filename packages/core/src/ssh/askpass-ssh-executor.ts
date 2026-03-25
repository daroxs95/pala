import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SshConnectionOptions } from "../models/ssh";
import type { PlatformAdapter } from "../platform/platform-adapter";
import { buildSshSpawnConfiguration } from "./ssh-connection";
import { writeSshDebugLog } from "./ssh-debug-log";

export interface AskpassSshExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export async function executeWithPasswordAskpass(
  platform: PlatformAdapter,
  hostAlias: string,
  command: string,
  timeoutMs: number,
  connection: SshConnectionOptions,
  signal?: AbortSignal,
): Promise<AskpassSshExecutionResult> {
  if (!connection.password) {
    throw new Error("Password is required for askpass SSH execution.");
  }

  const startedAt = Date.now();
  const helperDirectory = await mkdtemp(join(tmpdir(), "pala-ssh-askpass-"));
  const helperPath = join(helperDirectory, "askpass.cmd");
  const spawnConfiguration = await buildSshSpawnConfiguration(hostAlias, [command], connection);

  await writeFile(
    helperPath,
    [
      "@echo off",
      "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"[Console]::Out.Write($env:PALA_SSH_PASSWORD)\"",
      "",
    ].join("\r\n"),
    "utf8",
  );

  await writeSshDebugLog({
    event: "askpass-spawn",
    hostAlias,
    sshBinary: platform.getSshBinary(),
    args: spawnConfiguration.args,
    remoteCommand: command,
    connection,
    note: "Password-based SSH routed through SSH_ASKPASS helper.",
  });

  const sshProcess = platform.spawn(platform.getSshBinary(), spawnConfiguration.args, {
    env: {
      ...process.env,
      DISPLAY: "pala",
      SSH_ASKPASS: helperPath,
      SSH_ASKPASS_REQUIRE: "force",
      PALA_SSH_PASSWORD: connection.password,
    },
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  // Avoid stdin-based prompts and force ssh.exe down the askpass path.
  sshProcess.stdin.end();

  const onAbort = () => {
    sshProcess.kill();
  };

  if (signal) {
    if (signal.aborted) {
      sshProcess.kill();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    sshProcess.kill();
  }, timeoutMs);

  return await new Promise<AskpassSshExecutionResult>((resolve, reject) => {
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
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });

  async function cleanup(): Promise<void> {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }

    try {
      await rm(helperDirectory, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for temporary askpass helper files.
    }
  }
}
