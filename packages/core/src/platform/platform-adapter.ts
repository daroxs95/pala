import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

type SpawnedProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface PlatformAdapter {
  getSshConfigPath(): string;
  getSshBinary(): string;
  spawn(
    command: string,
    args: string[],
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
    return "ssh";
  }

  spawn(command: string, args: string[]): SpawnedProcess {
    return spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  }
}

export function getDefaultPlatformAdapter(): PlatformAdapter {
  if (process.platform === "win32") {
    return new WindowsPlatformAdapter();
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}
