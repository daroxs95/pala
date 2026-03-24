import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface TuiPersistedState {
  lastSelectedHostAlias?: string;
}

const STATE_FILE_PATH = resolve(process.cwd(), "..", "..", ".pala", "tui-state.json");

export async function loadTuiState(): Promise<TuiPersistedState> {
  try {
    const raw = await readFile(STATE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as TuiPersistedState;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveTuiState(state: TuiPersistedState): Promise<void> {
  await mkdir(dirname(STATE_FILE_PATH), { recursive: true });
  await writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf8");
}

