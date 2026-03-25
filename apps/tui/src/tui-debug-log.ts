import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const TUI_DEBUG_LOG_PATH = resolve(process.cwd(), "..", "..", ".pala", "tui-debug.log");

export async function writeTuiDebugLog(event: string, details?: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(TUI_DEBUG_LOG_PATH), { recursive: true });
  await appendFile(
    TUI_DEBUG_LOG_PATH,
    `${JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...(details ?? {}),
    })}\n`,
    "utf8",
  );
}
