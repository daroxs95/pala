import blessed from "blessed";
import {
  closeSshConnection,
  collectSystemOverview,
  getDefaultPlatformAdapter,
  getSshSessionModeLabel,
  loadSshHosts,
  probeHost,
  type HostConfigEntry,
  type HostProbeResult,
  type SshSessionMode,
  type SystemOverview,
  resolveSshConnectionOptions,
} from "@pala/core";

type FocusPane = "hosts" | "details" | "output";
type DetailTab = "overview" | "probe";

interface ProbeSnapshot {
  alias: string;
  durationMs: number;
  result: HostProbeResult;
}

interface OverviewSnapshot {
  alias: string;
  durationMs: number;
  result: SystemOverview;
}

interface AppState {
  hosts: HostConfigEntry[];
  selectedHostIndex: number;
  focus: FocusPane;
  activeTab: DetailTab;
  sshMode: SshSessionMode;
  logs: string[];
  statusText: string;
  lastProbeByHost: Record<string, ProbeSnapshot>;
  lastOverviewByHost: Record<string, OverviewSnapshot>;
  touchedPersistentHosts: Set<string>;
}

const palette = {
  background: "#101418",
  panel: "#162028",
  border: "#2a3b47",
  text: "#d7e3ec",
  muted: "#b1c2cf",
  accent: "#5ad1a4",
  warning: "#f4bf75",
};

async function main(): Promise<void> {
  const platform = getDefaultPlatformAdapter();
  const state: AppState = {
    hosts: [],
    selectedHostIndex: 0,
    focus: "hosts",
    activeTab: "overview",
    sshMode: "persistent",
    logs: [],
    statusText: "Loading hosts from ~/.ssh/config",
    lastProbeByHost: {},
    lastOverviewByHost: {},
    touchedPersistentHosts: new Set<string>(),
  };

  const screen = blessed.screen({
    smartCSR: true,
    title: "pala tui",
    dockBorders: true,
    fullUnicode: false,
  });

  screen.key(["q", "C-c"], () => {
    void shutdown();
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
    content: "",
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
    keys: false,
    mouse: true,
    scrollbar: {
      ch: " ",
      style: {
        bg: palette.border,
      },
    },
  });

  const detailTabs = blessed.box({
    parent: detailPanel,
    top: 0,
    left: 1,
    width: "100%-4",
    height: 1,
    tags: true,
    style: {
      fg: palette.text,
      bg: palette.panel,
    },
  });

  const detailBody = blessed.box({
    parent: detailPanel,
    top: 2,
    left: 1,
    width: "100%-4",
    height: "100%-5",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: true,
    style: {
      fg: palette.text,
      bg: palette.panel,
    },
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
      " {bold}j/k{/bold} move  {bold}tab{/bold} focus  {bold}1{/bold}/{bold}2{/bold} tabs  {bold}enter{/bold} probe  {bold}o{/bold} overview  {bold}m{/bold} mode  {bold}r{/bold} reload  {bold}q{/bold} quit ",
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

  screen.key(["1"], () => {
    state.activeTab = "overview";
    render();
  });

  screen.key(["2"], () => {
    state.activeTab = "probe";
    render();
  });

  screen.key(["r"], async () => {
    await reloadHosts();
  });

  screen.key(["m"], () => {
    state.sshMode = state.sshMode === "stateless" ? "persistent" : "stateless";
    state.statusText = `SSH mode set to ${state.sshMode}`;
    appendLog(`ssh mode changed to ${state.sshMode}`);
    render();
  });

  screen.key(["enter"], async () => {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runProbe(selectedHost.alias);
  });

  screen.key(["o"], async () => {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runOverview(selectedHost.alias);
  });

  hostsList.on("select", async (_, index) => {
    state.selectedHostIndex = index;
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (selectedHost && !state.lastOverviewByHost[selectedHost.alias]) {
      void runOverview(selectedHost.alias, true);
    }
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

    header.setContent(
      `{bold}pala{/bold}  ssh vps monitor  {gray-fg}mode:${getSshSessionModeLabel(state.sshMode)}{/gray-fg}`,
    );
    detailPanel.setLabel(" Details ");
    detailTabs.setContent(formatDetailTabs(state.activeTab));
    detailBody.setContent(getDetailLines(state).join("\n"));
    detailBody.setScroll(0);
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
      state.statusText = `Loaded ${state.hosts.length} hosts`;
      appendLog(`loaded ${state.hosts.length} host aliases`);
      const selectedHost = state.hosts[state.selectedHostIndex];
      if (selectedHost) {
        void runOverview(selectedHost.alias, true);
      }
    } catch (error) {
      state.statusText = "Failed to load SSH config";
      appendLog(`error: ${formatError(error)}`);
    }

    render();
  }

  async function runProbe(alias: string): Promise<void> {
    state.activeTab = "probe";
    state.statusText = `Probing ${alias}`;
    appendLog(`probe started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await probeHost(
        platform,
        alias,
        10_000,
        resolveSshConnectionOptions({ mode: state.sshMode }),
      );
      state.lastProbeByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
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
      appendLog(`probe error for ${alias}: ${formatError(error)}`);
    }

    render();
  }

  async function runOverview(alias: string, silent = false): Promise<void> {
    state.activeTab = "overview";
    state.statusText = `Collecting overview for ${alias}`;
    appendLog(silent ? `overview auto-refresh started for ${alias}` : `overview started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await collectSystemOverview(
        platform,
        alias,
        30_000,
        resolveSshConnectionOptions({ mode: state.sshMode }),
      );
      state.lastOverviewByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
      state.statusText = `Overview collected for ${alias} in ${durationMs}ms`;
      appendLog(`${silent ? "overview auto-refresh" : "overview"} finished for ${alias} in ${durationMs}ms`);
      for (const warning of result.warnings) {
        appendLog(`warning: ${warning}`);
      }
    } catch (error) {
      state.statusText = `Overview failed for ${alias}`;
      appendLog(`overview error for ${alias}: ${formatError(error)}`);
    }

    render();
  }

  function appendLog(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    state.logs.push(`[${timestamp}] ${message}`);
  }

  function markPersistentHost(alias: string): void {
    if (state.sshMode === "persistent") {
      state.touchedPersistentHosts.add(alias);
    }
  }

  async function shutdown(): Promise<void> {
    if (state.touchedPersistentHosts.size > 0) {
      appendLog("closing persistent ssh connections");
      render();
    }

    const hosts = [...state.touchedPersistentHosts];
    for (const hostAlias of hosts) {
      try {
        await closeSshConnection(
          platform,
          hostAlias,
          resolveSshConnectionOptions({ mode: "persistent" }),
        );
      } catch (error) {
        appendLog(`close error for ${hostAlias}: ${formatError(error)}`);
      }
    }

    screen.destroy();
    process.exit(0);
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

function formatDetailTabs(activeTab: DetailTab): string {
  const overview = activeTab === "overview"
    ? `{black-fg}{green-bg} 1 Overview {/green-bg}{/black-fg}`
    : `{black-fg}{white-bg} 1 Overview {/white-bg}{/black-fg}`;
  const probe = activeTab === "probe"
    ? `{black-fg}{green-bg} 2 Probe {/green-bg}{/black-fg}`
    : `{black-fg}{white-bg} 2 Probe {/white-bg}{/black-fg}`;

  return `${overview}  ${probe}`;
}

function getDetailLines(state: AppState): string[] {
  const selectedHost = state.hosts[state.selectedHostIndex];
  if (!selectedHost) {
    return [
      "No host selected.",
      "",
      "Press r to reload the SSH config.",
    ];
  }

  if (state.activeTab === "overview") {
    const snapshot = state.lastOverviewByHost[selectedHost.alias];
    if (snapshot) {
      return formatOverview(snapshot.alias, snapshot.result, snapshot.durationMs);
    }

    return [
      `Host: ${selectedHost.alias}`,
      "",
      "Overview has not been collected yet.",
      "It will auto-load when the host is selected.",
      "Press o to refresh it manually.",
    ];
  }

  const snapshot = state.lastProbeByHost[selectedHost.alias];
  if (snapshot) {
    return formatProbe(snapshot.alias, snapshot.result, snapshot.durationMs);
  }

  return [
    `Host: ${selectedHost.alias}`,
    "",
    "Probe has not been collected yet.",
    "Press Enter to run the capability probe.",
  ];
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

function formatOverview(alias: string, result: SystemOverview, durationMs: number): string[] {
  return [
    `Host: ${alias}`,
    `Hostname: ${result.host.hostname}`,
    `Kernel: ${result.host.kernel}`,
    `Uptime: ${result.host.uptimeText}`,
    `Duration: ${durationMs}ms`,
    "",
    "CPU",
    `  load avg: ${result.cpu.loadAverage1m} / ${result.cpu.loadAverage5m} / ${result.cpu.loadAverage15m}`,
    `  processes: ${result.cpu.runningProcesses} running / ${result.cpu.totalProcesses} total`,
    "",
    "Memory",
    `  used: ${formatBytes(result.memory.usedBytes)} / ${formatBytes(result.memory.totalBytes)} (${result.memory.usedPercent}%)`,
    `  available: ${formatBytes(result.memory.availableBytes)}`,
    "",
    "Filesystems",
    ...(result.filesystems.length > 0
      ? result.filesystems.slice(0, 5).map((filesystem) =>
          `  ${filesystem.mountPoint}  ${formatBytes(filesystem.usedBytes)} / ${formatBytes(filesystem.sizeBytes)} (${filesystem.usedPercent}%)`
        )
      : ["  none"]),
    "",
    "Top Processes",
    ...(result.topProcesses.length > 0
      ? result.topProcesses.slice(0, 5).map((process) =>
          `  ${process.pid} ${process.user} cpu=${process.cpuPercent}% mem=${process.memoryPercent}% ${process.command}`
        )
      : ["  none"]),
    "",
    "Warnings",
    ...(result.warnings.length > 0 ? result.warnings : ["  none"]),
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

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  const precision = current >= 10 ? 0 : 1;
  return `${current.toFixed(precision)} ${units[unitIndex]}`;
}

void main();
