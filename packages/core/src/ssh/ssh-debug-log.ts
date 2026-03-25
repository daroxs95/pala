import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { SshConnectionOptions } from "../models/ssh";

const SSH_DEBUG_LOG_PATH = resolve(process.cwd(), "..", "..", ".pala", "ssh-debug.log");

interface SshDebugEvent {
  event: string;
  hostAlias: string;
  sshBinary?: string;
  args?: string[];
  remoteCommand?: string;
  connection?: SshConnectionOptions;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  stderr?: string;
  stdout?: string;
  note?: string;
}

export async function writeSshDebugLog(event: SshDebugEvent): Promise<void> {
  const payload = {
    at: new Date().toISOString(),
    ...event,
    ...(event.connection ? { connection: redactConnection(event.connection) } : {}),
  };

  await mkdir(dirname(SSH_DEBUG_LOG_PATH), { recursive: true });
  await appendFile(SSH_DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`, "utf8");
}

function redactConnection(connection: SshConnectionOptions): Record<string, unknown> {
  return {
    ...(connection.mode ? { mode: connection.mode } : {}),
    ...(connection.connectTimeoutSeconds ? { connectTimeoutSeconds: connection.connectTimeoutSeconds } : {}),
    ...(connection.controlPersistSeconds ? { controlPersistSeconds: connection.controlPersistSeconds } : {}),
    ...(connection.password ? { password: "<redacted>" } : {}),
  };
}
