import {
  createErrorResponse,
  createSuccessResponse,
  getDefaultPlatformAdapter,
  loadSshHosts,
  probeHost,
} from "@pala/core";

async function main(): Promise<void> {
  const startedAt = Date.now();
  const [command, ...args] = process.argv.slice(2);
  const platform = getDefaultPlatformAdapter();

  try {
    switch (command) {
      case "list-hosts": {
        const hosts = await loadSshHosts(platform.getSshConfigPath());
        printJson(createSuccessResponse(hosts, Date.now() - startedAt));
        return;
      }
      case "probe-host": {
        const alias = args[0];
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

        const { result, durationMs } = await probeHost(platform, alias);
        printJson(createSuccessResponse(result, durationMs, alias, result.warnings));
        process.exitCode = result.reachable ? 0 : 1;
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
              ],
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
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

void main();
