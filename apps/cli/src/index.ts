import {
  closeSshConnection,
  getContainerStats,
  listContainers,
  collectSystemOverview,
  createErrorResponse,
  createSuccessResponse,
  getDefaultPlatformAdapter,
  loadSshHosts,
  parseSshSessionMode,
  probeHost,
  resolveSshConnectionOptions,
} from "@pala/core";

async function main(): Promise<void> {
  const startedAt = Date.now();
  const parsed = parseCliArgs(process.argv.slice(2));
  const { command, positionalArgs, sshMode, invalidSshMode } = parsed;
  const platform = getDefaultPlatformAdapter();
  const touchedHosts = new Set<string>();

  if (invalidSshMode) {
    printJson(
      createErrorResponse(
        "INVALID_ARGUMENT",
        `Unsupported ssh mode: ${invalidSshMode}`,
        Date.now() - startedAt,
        undefined,
        { supportedSshModes: ["stateless", "persistent"] },
      ),
    );
    process.exitCode = 1;
    return;
  }

  const connection = buildConnectionOptions(sshMode);

  try {
    switch (command) {
      case "list-hosts": {
        const hosts = await loadSshHosts(platform.getSshConfigPath());
        printJson(createSuccessResponse(hosts, Date.now() - startedAt));
        return;
      }
      case "probe-host": {
        const alias = positionalArgs[0];
        if (!alias) {
          printJson(
            createErrorResponse(
              "INVALID_ARGUMENT",
              "Host alias is required.",
              Date.now() - startedAt,
            ),
          );
          process.exitCode = 1;
          return;
        }

        const { result, durationMs } = await probeHost(platform, alias, 10_000, connection);
        touchedHosts.add(alias);
        printJson(createSuccessResponse(result, durationMs, alias, result.warnings));
        process.exitCode = result.reachable ? 0 : 1;
        return;
      }
      case "get-overview": {
        const alias = positionalArgs[0];
        if (!alias) {
          printJson(
            createErrorResponse(
              "INVALID_ARGUMENT",
              "Host alias is required.",
              Date.now() - startedAt,
            ),
          );
          process.exitCode = 1;
          return;
        }

        const { result, durationMs } = await collectSystemOverview(platform, alias, 30_000, connection);
        touchedHosts.add(alias);
        printJson(createSuccessResponse(result, durationMs, alias, result.warnings));
        return;
      }
      case "list-containers": {
        const alias = positionalArgs[0];
        if (!alias) {
          printJson(
            createErrorResponse(
              "INVALID_ARGUMENT",
              "Host alias is required.",
              Date.now() - startedAt,
            ),
          );
          process.exitCode = 1;
          return;
        }

        const { result, durationMs } = await listContainers(platform, alias, 20_000, connection);
        touchedHosts.add(alias);
        printJson(createSuccessResponse(result, durationMs, alias, result.warnings));
        process.exitCode = result.dockerAvailable ? 0 : 1;
        return;
      }
      case "get-container-stats": {
        const alias = positionalArgs[0];
        if (!alias) {
          printJson(
            createErrorResponse(
              "INVALID_ARGUMENT",
              "Host alias is required.",
              Date.now() - startedAt,
            ),
          );
          process.exitCode = 1;
          return;
        }

        const { result, durationMs } = await getContainerStats(platform, alias, 20_000, connection);
        touchedHosts.add(alias);
        printJson(createSuccessResponse(result, durationMs, alias, result.warnings));
        process.exitCode = result.dockerAvailable ? 0 : 1;
        return;
      }
      case "close-connection": {
        const alias = positionalArgs[0];
        if (!alias) {
          printJson(
            createErrorResponse(
              "INVALID_ARGUMENT",
              "Host alias is required.",
              Date.now() - startedAt,
            ),
          );
          process.exitCode = 1;
          return;
        }

        await closeSshConnection(platform, alias, connection);
        printJson(createSuccessResponse({
          host: alias,
          mode: connection.mode,
          closed: true,
        }, Date.now() - startedAt, alias));
        return;
      }
      default: {
        printJson(
          createErrorResponse(
            "UNKNOWN_COMMAND",
            `Unknown command: ${command ?? "<missing>"}`,
            Date.now() - startedAt,
            undefined,
            {
              supportedCommands: [
                "list-hosts",
                "probe-host <alias>",
                "get-overview <alias>",
                "list-containers <alias>",
                "get-container-stats <alias>",
                "close-connection <alias>",
              ],
              supportedSshModes: ["stateless", "persistent"],
            },
          ),
        );
        process.exitCode = 1;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    printJson(
      createErrorResponse(
        "UNEXPECTED_ERROR",
        message,
        Date.now() - startedAt,
      ),
    );
    process.exitCode = 1;
  } finally {
    if (connection.mode === "persistent") {
      for (const hostAlias of touchedHosts) {
        try {
          await closeSshConnection(platform, hostAlias, connection);
        } catch {
          // Best effort cleanup for one-shot CLI commands.
        }
      }
    }
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseCliArgs(argv: string[]): {
  command?: string;
  positionalArgs: string[];
  sshMode?: "stateless" | "persistent";
  invalidSshMode?: string;
} {
  const positionalArgs: string[] = [];
  let sshMode: "stateless" | "persistent" | undefined;
  let invalidSshMode: string | undefined;
  let command: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--ssh-mode=")) {
      const requestedMode = arg.slice("--ssh-mode=".length);
      const parsedMode = parseSshSessionMode(requestedMode);
      if (parsedMode) {
        sshMode = parsedMode;
      } else {
        invalidSshMode = requestedMode;
      }
      continue;
    }

    if (!command) {
      command = arg;
      continue;
    }

    positionalArgs.push(arg);
  }

  return {
    ...(command ? { command } : {}),
    positionalArgs,
    ...(sshMode ? { sshMode } : {}),
    ...(invalidSshMode ? { invalidSshMode } : {}),
  };
}

function buildConnectionOptions(mode?: "stateless" | "persistent") {
  return mode
    ? resolveSshConnectionOptions({ mode })
    : resolveSshConnectionOptions();
}

void main();
