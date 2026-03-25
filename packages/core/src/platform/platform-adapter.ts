import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type SpawnedProcess = ChildProcessWithoutNullStreams;

export interface PlatformSpawnOptions {
  env?: NodeJS.ProcessEnv;
}

export interface PlatformAdapter {
  getSshConfigPath(): string;
  getSshBinary(): string;
  spawn(
    command: string,
    args: string[],
    options?: PlatformSpawnOptions,
  ): SpawnedProcess;
}

export class WindowsPlatformAdapter implements PlatformAdapter {
  getSshConfigPath(): string {
    const userProfile = process.env.USERPROFILE;
    if (!userProfile) {
      throw new Error("USERPROFILE is not defined");
    }

    return `${userProfile}\\.ssh\\config`;
  }

  getSshBinary(): string {
    const windowsDirectory = process.env.WINDIR ?? "C:\\Windows";
    const bundledOpenSsh = join(windowsDirectory, "System32", "OpenSSH", "ssh.exe");
    if (existsSync(bundledOpenSsh)) {
      return bundledOpenSsh;
    }

    return "ssh";
  }

  spawn(command: string, args: string[], options?: PlatformSpawnOptions): SpawnedProcess {
    return spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(options?.env ? { env: options.env } : {}),
    });
  }
}

export function getDefaultPlatformAdapter(): PlatformAdapter {
  if (process.platform === "win32") {
    return new WindowsPlatformAdapter();
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}
