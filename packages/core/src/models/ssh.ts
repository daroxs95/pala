export type SshSessionMode = "stateless" | "persistent";

export interface SshConnectionOptions {
  mode?: SshSessionMode;
  connectTimeoutSeconds?: number;
  controlPersistSeconds?: number;
}

