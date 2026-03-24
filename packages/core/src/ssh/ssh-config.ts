import { readFile } from "node:fs/promises";

import type { HostConfigEntry } from "../models/host";

const SUPPORTED_FIELDS = new Set([
  "hostname",
  "user",
  "port",
  "identityfile",
]);

interface MutableHostEntry {
  aliases: string[];
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

export async function loadSshHosts(configPath: string): Promise<HostConfigEntry[]> {
  const raw = await readFile(configPath, "utf8");
  return parseSshConfig(raw);
}

export function parseSshConfig(raw: string): HostConfigEntry[] {
  const entries: MutableHostEntry[] = [];
  let current: MutableHostEntry | undefined;

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = stripComment(rawLine).trim();
    if (!trimmed) {
      continue;
    }

    const [keyword, ...rest] = trimmed.split(/\s+/);
    const value = rest.join(" ").trim();
    if (!keyword || !value) {
      continue;
    }

    const normalizedKeyword = keyword.toLowerCase();
    if (normalizedKeyword === "host") {
      const aliases = value
        .split(/\s+/)
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0 && !hasWildcard(alias));

      current = aliases.length > 0 ? { aliases } : undefined;
      if (current) {
        entries.push(current);
      }
      continue;
    }

    if (!current || !SUPPORTED_FIELDS.has(normalizedKeyword)) {
      continue;
    }

    switch (normalizedKeyword) {
      case "hostname":
        current.hostname = value;
        break;
      case "user":
        current.user = value;
        break;
      case "port":
        current.port = Number.parseInt(value, 10);
        break;
      case "identityfile":
        current.identityFile = value;
        break;
      default:
        break;
    }
  }

  return entries.flatMap((entry) =>
    entry.aliases.map((alias) => {
      const host: HostConfigEntry = { alias };
      const port = entry.port;

      if (entry.hostname) {
        host.hostname = entry.hostname;
      }
      if (entry.user) {
        host.user = entry.user;
      }
      if (typeof port === "number" && Number.isFinite(port)) {
        host.port = port;
      }
      if (entry.identityFile) {
        host.identityFile = entry.identityFile;
      }

      return host;
    }),
  );
}

function stripComment(line: string): string {
  const commentStart = line.indexOf("#");
  return commentStart >= 0 ? line.slice(0, commentStart) : line;
}

function hasWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}
