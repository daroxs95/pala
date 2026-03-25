import type { SshConnectionOptions, SshSessionMode } from "../models/ssh";

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;

export interface SshSpawnConfiguration {
  args: string[];
}

export async function buildSshArgs(
  hostAlias: string,
  remoteArgs: string[],
  options?: SshConnectionOptions,
): Promise<string[]> {
  const args = [
    "-o",
    `BatchMode=${options?.password ? "no" : "yes"}`,
    "-o",
    `ConnectTimeout=${options?.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS}`,
  ];

  if (options?.password) {
    args.push(
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "PreferredAuthentications=password,keyboard-interactive",
      "-o",
      "NumberOfPasswordPrompts=1",
    );
  }

  return [...args, hostAlias, ...remoteArgs];
}

export async function buildSshSpawnConfiguration(
  hostAlias: string,
  remoteArgs: string[],
  options?: SshConnectionOptions,
): Promise<SshSpawnConfiguration> {
  return {
    args: await buildSshArgs(hostAlias, remoteArgs, options),
  };
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
