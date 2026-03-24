import type { SshConnectionOptions, SshSessionMode } from "../models/ssh";

export function resolveSshConnectionOptions(input?: Partial<SshConnectionOptions>): SshConnectionOptions {
  return {
    mode: input?.mode ?? "persistent",
    connectTimeoutSeconds: input?.connectTimeoutSeconds ?? 5,
    controlPersistSeconds: input?.controlPersistSeconds ?? 600,
  };
}

export function parseSshSessionMode(value?: string): SshSessionMode | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "stateless" || value === "persistent") {
    return value;
  }

  return undefined;
}
