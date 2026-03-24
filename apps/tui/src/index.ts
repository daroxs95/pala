import blessed from "blessed";
import {
  getDefaultPlatformAdapter,
  loadSshHosts,
  probeHost,
  type HostConfigEntry,
  type HostProbeResult,
} from "@pala/core";

type FocusPane = "hosts" | "details" | "output";

interface AppState {
  hosts: HostConfigEntry[];
  selectedHostIndex: number;
  focus: FocusPane;
  logs: string[];
  detailLines: string[];
  statusText: string;
  lastProbe?: HostProbeResult;
}

const palette = {
  background: "#101418",
  panel: "#162028",
  border: "#2a3b47",
  text: "#d7e3ec",
  muted: "#7f96a8",
  accent: "#5ad1a4",
  warning: "#f4bf75",
};

async function main(): Promise<void> {
  const platform = getDefaultPlatformAdapter();
  const state: AppState = {
    hosts: [],
    selectedHostIndex: 0,
    focus: "hosts",
    logs: [],
    detailLines: [
      "Select a host in the left panel.",
      "Press Enter to run a capability probe.",
      "Press r to reload the SSH config.",
    ],
    statusText: "Loading hosts from ~/.ssh/config",
  };

  const screen = blessed.screen({
    smartCSR: true,
    title: "pala tui",
    dockBorders: true,
    fullUnicode: false,
  });

  screen.key(["q", "C-c"], () => {
    screen.destroy();
    process.exit(0);
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: {
      fg: palette.text,
      bg: palette.background,
    },
    content: "{bold}pala{/bold}  ssh vps monitor  {gray-fg}lazygit-style navigation{/gray-fg}",
  });

  const hostsPanel = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: "28%",
    height: "88%",
    label: " Hosts ",
    tags: true,
    border: "line",
    style: panelStyle(),
  });

  const hostsList = blessed.list({
    parent: hostsPanel,
    top: 0,
    left: 0,
    width: "100%-2",
    height: "100%-2",
    keys: false,
    mouse: true,
    tags: true,
    vi: false,
    style: {
      bg: palette.panel,
      fg: palette.text,
      selected: {
        bg: palette.accent,
        fg: palette.background,
        bold: true,
      },
      item: {
        bg: palette.panel,
        fg: palette.text,
      },
    },
    scrollbar: {
      ch: " ",
      style: {
        bg: palette.border,
      },
    },
  });

  const detailPanel = blessed.box({
    parent: screen,
    top: 1,
    left: "28%",
    width: "72%",
    height: "58%",
    label: " Details ",
    tags: true,
    border: "line",
    style: panelStyle(),
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: true,
    scrollbar: {
      ch: " ",
      style: {
        bg: palette.border,
      },
    },
  });

  const outputPanel = blessed.box({
    parent: screen,
    top: "59%",
    left: "28%",
    width: "72%",
    height: "30%",
    label: " Activity ",
    tags: true,
    border: "line",
    style: panelStyle(),
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: true,
    scrollbar: {
      ch: " ",
      style: {
        bg: palette.border,
      },
    },
  });

  const statusBar = blessed.box({
    parent: screen,
    bottom: 1,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: {
      fg: palette.text,
      bg: palette.panel,
    },
  });

  const helpBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: {
      fg: palette.muted,
      bg: palette.background,
    },
    content:
      " {bold}j/k{/bold} move  {bold}tab{/bold} focus  {bold}enter{/bold} probe  {bold}r{/bold} reload  {bold}q{/bold} quit ",
  });

  screen.key(["j", "down"], () => {
    if (state.focus !== "hosts" || state.hosts.length === 0) {
      return;
    }

    state.selectedHostIndex = Math.min(state.selectedHostIndex + 1, state.hosts.length - 1);
    render();
  });

  screen.key(["k", "up"], () => {
    if (state.focus !== "hosts" || state.hosts.length === 0) {
      return;
    }

    state.selectedHostIndex = Math.max(state.selectedHostIndex - 1, 0);
    render();
  });

  screen.key(["tab"], () => {
    state.focus = nextFocus(state.focus);
    render();
  });

  screen.key(["r"], async () => {
    await reloadHosts();
  });

  screen.key(["enter"], async () => {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runProbe(selectedHost.alias);
  });

  hostsList.on("select", async (_, index) => {
    state.selectedHostIndex = index;
    render();
  });

  await reloadHosts();

  function render(): void {
    const hostItems = state.hosts.map((host) => {
      const secondary = [host.user, host.hostname].filter(Boolean).join("@");
      return secondary ? `${host.alias} {gray-fg}${secondary}{/gray-fg}` : host.alias;
    });

    hostsList.setItems(hostItems);
    hostsList.select(state.selectedHostIndex);

    detailPanel.setContent(state.detailLines.join("\n"));
    outputPanel.setContent(state.logs.slice(-200).join("\n"));
    statusBar.setContent(` ${state.statusText} `);

    applyFocusState(hostsPanel, detailPanel, outputPanel, state.focus);
    screen.render();
  }

  async function reloadHosts(): Promise<void> {
    state.statusText = "Reloading SSH config";
    appendLog("loading ssh hosts from configured path");
    render();

    try {
      state.hosts = await loadSshHosts(platform.getSshConfigPath());
      state.selectedHostIndex = Math.min(state.selectedHostIndex, Math.max(state.hosts.length - 1, 0));
      state.detailLines = [
        `Discovered ${state.hosts.length} host aliases.`,
        "",
        "Navigation",
        "  - j / k: move through hosts",
        "  - Enter: probe selected host",
        "  - Tab: cycle focus between panes",
      ];
      state.statusText = `Loaded ${state.hosts.length} hosts`;
      appendLog(`loaded ${state.hosts.length} host aliases`);
    } catch (error) {
      state.statusText = "Failed to load SSH config";
      state.detailLines = [formatError(error)];
      appendLog(`error: ${formatError(error)}`);
    }

    render();
  }

  async function runProbe(alias: string): Promise<void> {
    state.statusText = `Probing ${alias}`;
    state.detailLines = [
      `Running capability probe for ${alias}`,
      "",
      "This uses the same system ssh path as the CLI.",
      "If the host is unreachable or prompts for input, the probe may time out.",
    ];
    appendLog(`probe started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await probeHost(platform, alias);
      state.lastProbe = result;
      state.detailLines = formatProbe(alias, result, durationMs);
      state.statusText = result.reachable
        ? `Probe succeeded for ${alias} in ${durationMs}ms`
        : `Probe finished with warnings for ${alias}`;
      appendLog(`probe finished for ${alias} in ${durationMs}ms`);
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          appendLog(`warning: ${warning}`);
        }
      }
    } catch (error) {
      state.statusText = `Probe failed for ${alias}`;
      state.detailLines = [formatError(error)];
      appendLog(`probe error for ${alias}: ${formatError(error)}`);
    }

    render();
  }

  function appendLog(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    state.logs.push(`[${timestamp}] ${message}`);
  }

  render();
  header.focus();
}

function panelStyle(): blessed.Widgets.BoxOptions["style"] {
  return {
    bg: palette.panel,
    fg: palette.text,
    border: {
      fg: palette.border,
    },
    label: {
      fg: palette.muted,
      bold: true,
    },
  };
}

function applyFocusState(
  hostsPanel: blessed.Widgets.BoxElement,
  detailPanel: blessed.Widgets.BoxElement,
  outputPanel: blessed.Widgets.BoxElement,
  focus: FocusPane,
): void {
  hostsPanel.style.border = { fg: focus === "hosts" ? palette.accent : palette.border };
  detailPanel.style.border = { fg: focus === "details" ? palette.accent : palette.border };
  outputPanel.style.border = { fg: focus === "output" ? palette.accent : palette.border };
}

function nextFocus(current: FocusPane): FocusPane {
  switch (current) {
    case "hosts":
      return "details";
    case "details":
      return "output";
    case "output":
      return "hosts";
  }
}

function formatProbe(alias: string, result: HostProbeResult, durationMs: number): string[] {
  return [
    `Host: ${alias}`,
    `Reachable: ${result.reachable ? "yes" : "no"}`,
    `Shell: ${result.shell ? "yes" : "no"}`,
    `Duration: ${durationMs}ms`,
    "",
    "Capabilities",
    `  docker: ${flag(result.capabilities.docker)}`,
    `  procfs: ${flag(result.capabilities.procfs)}`,
    `  systemd: ${flag(result.capabilities.systemd)}`,
    `  journalctl: ${flag(result.capabilities.journalctl)}`,
    `  ss: ${flag(result.capabilities.socketStats)}`,
    "",
    "Warnings",
    ...(result.warnings.length > 0 ? result.warnings : ["  none"]),
    "",
    "Raw stdout",
    result.raw.stdout || "  <empty>",
    "",
    "Raw stderr",
    result.raw.stderr || "  <empty>",
  ];
}

function flag(value: boolean): string {
  return value ? "yes" : "no";
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

void main();
