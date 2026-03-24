import type { SshConnectionOptions, SshSessionMode } from "../models/ssh";

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;

export async function buildSshArgs(
  hostAlias: string,
  remoteArgs: string[],
  options?: SshConnectionOptions,
): Promise<string[]> {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${options?.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS}`,
  ];

  return [...args, hostAlias, ...remoteArgs];
}

export async function buildSshCloseArgs(
  hostAlias: string,
  options?: SshConnectionOptions,
): Promise<string[] | undefined> {
  const mode = options?.mode ?? "stateless";
  if (mode !== "persistent") {
    return undefined;
  }

  return [hostAlias, "exit"];
}

export function getSshSessionModeLabel(mode?: SshSessionMode): string {
  return mode ?? "stateless";
}
