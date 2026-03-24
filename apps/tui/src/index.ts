import blessed from "blessed";
import { loadTuiState, saveTuiState } from "./tui-state";
import {
  closeSshConnection,
  collectSystemOverview,
  getDefaultPlatformAdapter,
  getContainerStats,
  getSshSessionModeLabel,
  listContainers,
  loadSshHosts,
  probeHost,
  type ContainerListResult,
  type ContainerStatsResult,
  type HostConfigEntry,
  type HostProbeResult,
  type SshSessionMode,
  type SystemOverview,
  resolveSshConnectionOptions,
} from "@pala/core";

type FocusPane = "hosts" | "details" | "output";
type DetailTab = "overview" | "probe" | "containers" | "stats";

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

interface ContainerSnapshot {
  alias: string;
  durationMs: number;
  result: ContainerListResult;
}

interface ContainerStatsSnapshotState {
  alias: string;
  durationMs: number;
  result: ContainerStatsResult;
}

interface AppState {
  hosts: HostConfigEntry[];
  selectedHostIndex: number;
  focus: FocusPane;
  activeTab: DetailTab;
  sshMode: SshSessionMode;
  hostPickerOpen: boolean;
  logs: string[];
  statusText: string;
  lastProbeByHost: Record<string, ProbeSnapshot>;
  lastOverviewByHost: Record<string, OverviewSnapshot>;
  lastContainersByHost: Record<string, ContainerSnapshot>;
  lastContainerStatsByHost: Record<string, ContainerStatsSnapshotState>;
  lastSelectedHostAlias?: string;
  touchedPersistentHosts: Set<string>;
}

const palette = {
  background: "#101418",
  panel: "#162028",
  border: "#d7e3ec",
  text: "#d7e3ec",
  muted: "#b1c2cf",
  accent: "#5ad1a4",
  warning: "#f4bf75",
};

async function main(): Promise<void> {
  const platform = getDefaultPlatformAdapter();
  const persistedState = await loadTuiState();
  const state: AppState = {
    hosts: [],
    selectedHostIndex: 0,
    focus: "hosts",
    activeTab: "overview",
    sshMode: "persistent",
    hostPickerOpen: true,
    logs: [],
    statusText: "Loading hosts from ~/.ssh/config",
    lastProbeByHost: {},
    lastOverviewByHost: {},
    lastContainersByHost: {},
    lastContainerStatsByHost: {},
    ...(persistedState.lastSelectedHostAlias
      ? { lastSelectedHostAlias: persistedState.lastSelectedHostAlias }
      : {}),
    touchedPersistentHosts: new Set<string>(),
  };

  const screen = blessed.screen({
    smartCSR: true,
    title: "pala tui",
    dockBorders: true,
    fullUnicode: false,
  });
  screen.program.hideCursor();

  screen.key(["q", "C-c"], () => {
    void shutdown();
  });

  screen.key(["h"], () => {
    state.hostPickerOpen = !state.hostPickerOpen;
    state.focus = state.hostPickerOpen ? "hosts" : "details";
    render();
  });

  screen.key(["escape"], () => {
    if (!state.hostPickerOpen) {
      return;
    }

    state.hostPickerOpen = false;
    state.focus = "details";
    render();
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
  hostsPanel.hide();

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
        bg: palette.text,
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
    left: 0,
    width: "100%",
    height: "57%",
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
    top: "58%",
    left: 0,
    width: "100%",
    height: "31%",
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
      " {bold}h{/bold} hosts  {bold}tab{/bold} focus  {bold}1{/bold}/{bold}2{/bold}/{bold}3{/bold}/{bold}4{/bold} tabs  {bold}enter{/bold} probe  {bold}o{/bold} overview  {bold}c{/bold} containers  {bold}s{/bold} stats  {bold}m{/bold} mode  {bold}r{/bold} reload  {bold}q{/bold} quit ",
  });

  const hostPicker = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "64%",
    height: "68%",
    label: " Select Host ",
    tags: true,
    border: "line",
    shadow: true,
    style: panelStyle(),
  });

  const hostPickerHint = blessed.box({
    parent: hostPicker,
    top: 0,
    left: 1,
    width: "100%-4",
    height: 1,
    tags: true,
    content: "{gray-fg}j/k or arrows to move, Enter to select, h or Esc to close{/gray-fg}",
    style: {
      fg: palette.muted,
      bg: palette.panel,
    },
  });

  const hostPickerList = blessed.list({
    parent: hostPicker,
    top: 2,
    left: 1,
    width: "100%-4",
    height: "100%-5",
    mouse: true,
    tags: true,
    style: {
      bg: palette.panel,
      fg: palette.text,
      selected: {
        bg: palette.text,
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

  screen.key(["j", "down"], () => {
    if (!state.hostPickerOpen || state.hosts.length === 0) {
      return;
    }

    state.selectedHostIndex = Math.min(state.selectedHostIndex + 1, state.hosts.length - 1);
    render();
  });

  screen.key(["k", "up"], () => {
    if (!state.hostPickerOpen || state.hosts.length === 0) {
      return;
    }

    state.selectedHostIndex = Math.max(state.selectedHostIndex - 1, 0);
    render();
  });

  screen.key(["tab"], () => {
    if (state.hostPickerOpen) {
      state.focus = "hosts";
      render();
      return;
    }

    state.focus = nextFocus(state.focus);
    render();
  });

  screen.key(["1"], async () => {
    state.activeTab = "overview";
    render();
    await refreshActiveTab();
  });

  screen.key(["2"], async () => {
    state.activeTab = "probe";
    render();
    await refreshActiveTab();
  });

  screen.key(["3"], async () => {
    state.activeTab = "containers";
    render();
    await refreshActiveTab();
  });

  screen.key(["4"], async () => {
    state.activeTab = "stats";
    render();
    await refreshActiveTab();
  });

  screen.key(["r"], async () => {
    await reloadHosts();
  });

  screen.key(["c"], async () => {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runContainers(selectedHost.alias);
  });

  screen.key(["s"], async () => {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost || state.hostPickerOpen) {
      return;
    }

    await runContainerStats(selectedHost.alias);
  });

  screen.key(["m"], () => {
    state.sshMode = state.sshMode === "stateless" ? "persistent" : "stateless";
    state.statusText = `SSH mode set to ${state.sshMode}`;
    appendLog(`ssh mode changed to ${state.sshMode}`);
    render();
  });

  screen.key(["enter"], async () => {
    if (state.hostPickerOpen) {
      await selectCurrentHost();
      return;
    }

    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runProbe(selectedHost.alias);
  });

  screen.key(["o"], async () => {
    if (state.hostPickerOpen) {
      return;
    }

    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runOverview(selectedHost.alias);
  });

  hostsList.on("select", async (_, index) => {
    state.selectedHostIndex = index;
    render();
  });

  hostPickerList.on("select", async (_, index) => {
    state.selectedHostIndex = index;
    await selectCurrentHost();
  });

  await reloadHosts();

  function render(): void {
    const hostItems = state.hosts.map((host) => {
      const secondary = [host.user, host.hostname].filter(Boolean).join("@");
      return secondary ? `${host.alias} {gray-fg}${secondary}{/gray-fg}` : host.alias;
    });

    hostsList.setItems(hostItems);
    hostsList.select(state.selectedHostIndex);
    hostPickerList.setItems(hostItems);
    hostPickerList.select(state.selectedHostIndex);

    header.setContent(
      `{bold}pala{/bold}  ssh vps monitor  {gray-fg}host:${state.hosts[state.selectedHostIndex]?.alias ?? "-"}{/gray-fg}  {gray-fg}mode:${getSshSessionModeLabel(state.sshMode)}{/gray-fg}`,
    );
    detailPanel.setLabel(" Details ");
    detailTabs.setContent(formatDetailTabs(state.activeTab));
    detailBody.setContent(getDetailLines(state).join("\n"));
    detailBody.setScroll(0);
    outputPanel.setContent(state.logs.slice(-200).join("\n"));
    statusBar.setContent(` ${state.statusText} `);
    hostPicker.hidden = !state.hostPickerOpen;

    applyFocusState(hostsPanel, detailPanel, outputPanel, state.focus);
    if (state.hostPickerOpen) {
      hostPicker.setFront();
      hostPickerList.focus();
    }
    screen.render();
  }

  async function reloadHosts(): Promise<void> {
    state.statusText = "Reloading SSH config";
    appendLog("loading ssh hosts from configured path");
    render();

    try {
      const loadedHosts = await loadSshHosts(platform.getSshConfigPath());
      state.hosts = loadedHosts;
      state.selectedHostIndex = findSelectedHostIndex(loadedHosts, state.lastSelectedHostAlias);
      state.hostPickerOpen = true;
      state.focus = "hosts";
      state.statusText = `Loaded ${state.hosts.length} hosts`;
      appendLog(`loaded ${state.hosts.length} host aliases`);
    } catch (error) {
      state.statusText = "Failed to load SSH config";
      appendLog(`error: ${formatError(error)}`);
    }

    render();
  }

  async function selectCurrentHost(): Promise<void> {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    state.lastSelectedHostAlias = selectedHost.alias;
    await saveTuiState({ lastSelectedHostAlias: selectedHost.alias });

    state.hostPickerOpen = false;
    state.focus = "details";
    state.statusText = `Selected host ${selectedHost.alias}`;
    appendLog(`selected host ${selectedHost.alias}`);
    render();

    if (!state.lastOverviewByHost[selectedHost.alias]) {
      await runOverview(selectedHost.alias, true);
    }
  }

  async function refreshActiveTab(): Promise<void> {
    if (state.hostPickerOpen) {
      return;
    }

    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    switch (state.activeTab) {
      case "overview":
        await runOverview(selectedHost.alias, true);
        return;
      case "probe":
        await runProbe(selectedHost.alias);
        return;
      case "containers":
        await runContainers(selectedHost.alias);
        return;
      case "stats":
        await runContainerStats(selectedHost.alias);
        return;
    }
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

  async function runContainers(alias: string): Promise<void> {
    state.activeTab = "containers";
    state.statusText = `Listing containers for ${alias}`;
    appendLog(`container list started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await listContainers(
        platform,
        alias,
        20_000,
        resolveSshConnectionOptions({ mode: state.sshMode }),
      );
      state.lastContainersByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
      state.statusText = result.dockerAvailable
        ? `Listed ${result.containers.length} containers for ${alias} in ${durationMs}ms`
        : `Docker not available on ${alias}`;
      appendLog(`container list finished for ${alias} in ${durationMs}ms`);
      for (const warning of result.warnings) {
        appendLog(`warning: ${warning}`);
      }
    } catch (error) {
      state.statusText = `Container listing failed for ${alias}`;
      appendLog(`container list error for ${alias}: ${formatError(error)}`);
    }

    render();
  }

  async function runContainerStats(alias: string): Promise<void> {
    state.activeTab = "stats";
    state.statusText = `Collecting container stats for ${alias}`;
    appendLog(`container stats started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await getContainerStats(
        platform,
        alias,
        20_000,
        resolveSshConnectionOptions({ mode: state.sshMode }),
      );
      state.lastContainerStatsByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
      state.statusText = result.dockerAvailable
        ? `Collected ${result.stats.length} container stats rows for ${alias} in ${durationMs}ms`
        : `Docker not available on ${alias}`;
      appendLog(`container stats finished for ${alias} in ${durationMs}ms`);
      for (const warning of result.warnings) {
        appendLog(`warning: ${warning}`);
      }
    } catch (error) {
      state.statusText = `Container stats failed for ${alias}`;
      appendLog(`container stats error for ${alias}: ${formatError(error)}`);
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
  hostsPanel.style.border = { fg: palette.border };
  detailPanel.style.border = { fg: palette.border };
  outputPanel.style.border = { fg: palette.border };
  hostsPanel.style.label = { fg: focus === "hosts" ? palette.text : palette.muted, bold: true };
  detailPanel.style.label = { fg: focus === "details" ? palette.text : palette.muted, bold: true };
  outputPanel.style.label = { fg: focus === "output" ? palette.text : palette.muted, bold: true };
}

function nextFocus(current: FocusPane): FocusPane {
  switch (current) {
    case "hosts":
      return "details";
    case "details":
      return "output";
    case "output":
      return "details";
  }
}

function formatDetailTabs(activeTab: DetailTab): string {
  const overview = activeTab === "overview"
    ? `{black-fg}{green-bg} 1 Overview {/green-bg}{/black-fg}`
    : `{black-fg}{white-bg} 1 Overview {/white-bg}{/black-fg}`;
  const probe = activeTab === "probe"
    ? `{black-fg}{green-bg} 2 Probe {/green-bg}{/black-fg}`
    : `{black-fg}{white-bg} 2 Probe {/white-bg}{/black-fg}`;
  const containers = activeTab === "containers"
    ? `{black-fg}{green-bg} 3 Containers {/green-bg}{/black-fg}`
    : `{black-fg}{white-bg} 3 Containers {/white-bg}{/black-fg}`;
  const stats = activeTab === "stats"
    ? `{black-fg}{green-bg} 4 Stats {/green-bg}{/black-fg}`
    : `{black-fg}{white-bg} 4 Stats {/white-bg}{/black-fg}`;

  return `${overview}  ${probe}  ${containers}  ${stats}`;
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

  if (state.activeTab === "containers") {
    const snapshot = state.lastContainersByHost[selectedHost.alias];
    if (snapshot) {
      return formatContainers(snapshot.alias, snapshot.result, snapshot.durationMs);
    }

    return [
      `Host: ${selectedHost.alias}`,
      "",
      "Container list has not been collected yet.",
      "Press c to list containers.",
    ];
  }

  if (state.activeTab === "stats") {
    const snapshot = state.lastContainerStatsByHost[selectedHost.alias];
    if (snapshot) {
      return formatContainerStats(snapshot.alias, snapshot.result, snapshot.durationMs);
    }

    return [
      `Host: ${selectedHost.alias}`,
      "",
      "Container stats have not been collected yet.",
      "Press s to collect a snapshot table.",
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
  const summaryBox = formatBox(
    "Probe Summary",
    formatTable(
      ["Field", "Value"],
      [
        ["Host", alias],
        ["Reachable", result.reachable ? "yes" : "no"],
        ["Shell", result.shell ? "yes" : "no"],
        ["Duration", `${durationMs}ms`],
      ],
    ),
  );

  const capabilitiesBox = formatBox(
    "Capabilities",
    formatTable(
      ["Feature", "Available"],
      [
        ["docker", flag(result.capabilities.docker)],
        ["procfs", flag(result.capabilities.procfs)],
        ["systemd", flag(result.capabilities.systemd)],
        ["journalctl", flag(result.capabilities.journalctl)],
        ["ss", flag(result.capabilities.socketStats)],
      ],
    ),
  );

  const warningsBox = formatBox(
    "Warnings",
    result.warnings.length > 0 ? result.warnings : ["none"],
  );

  const stdoutBox = formatBox(
    "Raw stdout",
    splitMultiline(result.raw.stdout || "<empty>"),
  );

  const stderrBox = formatBox(
    "Raw stderr",
    splitMultiline(result.raw.stderr || "<empty>"),
  );

  return [
    ...formatColumns(summaryBox, capabilitiesBox, 3),
    "",
    ...warningsBox,
    "",
    ...formatColumns(stdoutBox, stderrBox, 3),
  ];
}

function formatOverview(alias: string, result: SystemOverview, durationMs: number): string[] {
  const leftTop = formatBox(
    "Host",
    formatTable(
      ["Field", "Value"],
      [
        ["Alias", alias],
        ["Hostname", result.host.hostname],
        ["Duration", `${durationMs}ms`],
      ],
    ),
  );

  const rightTop = formatBox(
    "System",
    formatTable(
      ["Field", "Value"],
      [
        ["Kernel", result.host.kernel],
        ["Uptime", result.host.uptimeText],
      ],
    ),
  );

  const leftBottom = formatBox(
    "CPU",
    formatTable(
      ["Metric", "Value"],
      [
        ["Load 1m", String(result.cpu.loadAverage1m)],
        ["Load 5m", String(result.cpu.loadAverage5m)],
        ["Load 15m", String(result.cpu.loadAverage15m)],
        ["Running", String(result.cpu.runningProcesses)],
        ["Total", String(result.cpu.totalProcesses)],
      ],
    ),
  );

  const rightBottom = formatBox(
    "Memory",
    formatTable(
      ["Metric", "Value"],
      [
        ["Used", `${formatBytes(result.memory.usedBytes)} / ${formatBytes(result.memory.totalBytes)}`],
        ["Used %", `${result.memory.usedPercent}%`],
        ["Available", formatBytes(result.memory.availableBytes)],
        ["Free", formatBytes(result.memory.freeBytes)],
        ["Cached", formatBytes(result.memory.cachedBytes)],
      ],
    ),
  );

  const fileSystemsBox = formatBox(
    "Filesystems",
    result.filesystems.length > 0
      ? formatTable(
          ["Mount", "Used", "Size", "Use%"],
          result.filesystems.slice(0, 5).map((filesystem) => [
            filesystem.mountPoint,
            formatBytes(filesystem.usedBytes),
            formatBytes(filesystem.sizeBytes),
            `${filesystem.usedPercent}%`,
          ]),
        )
      : ["none"],
  );

  const processesBox = formatBox(
    "Top Processes",
    result.topProcesses.length > 0
      ? formatTable(
          ["PID", "User", "CPU%", "MEM%", "Command"],
          result.topProcesses.slice(0, 5).map((process) => [
            String(process.pid),
            process.user,
            String(process.cpuPercent),
            String(process.memoryPercent),
            process.command,
          ]),
        )
      : ["none"],
  );

  const warningsBox = formatBox(
    "Warnings",
    result.warnings.length > 0 ? result.warnings : ["none"],
  );

  return [
    ...formatColumns(leftTop, rightTop, 3),
    "",
    ...formatColumns(leftBottom, rightBottom, 3),
    "",
    ...fileSystemsBox,
    "",
    ...processesBox,
    "",
    ...warningsBox,
  ];
}

function formatContainers(alias: string, result: ContainerListResult, durationMs: number): string[] {
  const summaryBox = formatBox(
    "Containers Summary",
    formatTable(
      ["Field", "Value"],
      [
        ["Host", alias],
        ["Docker", result.dockerAvailable ? "yes" : "no"],
        ["Duration", `${durationMs}ms`],
        ["Rows", String(result.containers.length)],
      ],
    ),
  );

  const containersBox = formatBox(
    "Containers",
    result.dockerAvailable
      ? (result.containers.length > 0
          ? formatTable(
              ["Name", "State", "Image", "Ports"],
              result.containers.map((container) => [
                container.name,
                container.state,
                container.image,
                container.ports.map((port) => port.raw).join(", ") || "-",
              ]),
            )
          : ["none"])
      : ["docker command not available"],
  );

  const warningsBox = formatBox(
    "Warnings",
    result.warnings.length > 0 ? result.warnings : ["none"],
  );

  return [
    ...summaryBox,
    "",
    ...containersBox,
    "",
    ...warningsBox,
  ];
}

function formatContainerStats(alias: string, result: ContainerStatsResult, durationMs: number): string[] {
  const summaryBox = formatBox(
    "Stats Summary",
    formatTable(
      ["Field", "Value"],
      [
        ["Host", alias],
        ["Docker", result.dockerAvailable ? "yes" : "no"],
        ["Duration", `${durationMs}ms`],
        ["Rows", String(result.stats.length)],
      ],
    ),
  );

  const tableBox = formatBox(
    "Stats",
    result.dockerAvailable
      ? (result.stats.length > 0
          ? formatTable(
              ["Name", "CPU%", "Mem%", "Mem Use", "Net I/O", "Block I/O", "PIDs"],
              result.stats.map((stat) => [
                stat.name,
                String(stat.cpuPercent),
                String(stat.memoryPercent),
                `${formatBytes(stat.memoryUsageBytes)} / ${formatBytes(stat.memoryLimitBytes)}`,
                `${formatBytes(stat.netInputBytes)} / ${formatBytes(stat.netOutputBytes)}`,
                `${formatBytes(stat.blockInputBytes)} / ${formatBytes(stat.blockOutputBytes)}`,
                String(stat.pids),
              ]),
            )
          : ["none"])
      : ["docker command not available"],
  );

  const warningsBox = formatBox(
    "Warnings",
    result.warnings.length > 0 ? result.warnings : ["none"],
  );

  return [
    ...summaryBox,
    "",
    ...tableBox,
    "",
    ...warningsBox,
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

function formatTable(headers: string[], rows: string[][]): string[] {
  const normalizedRows = rows.map((row) => headers.map((_, index) => sanitizeCell(row[index] ?? "")));
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...normalizedRows.map((row) => row[index]?.length ?? 0),
    ),
  );

  const headerLine = formatRow(headers, widths);
  const dividerLine = widths.map((width) => "-".repeat(width)).join("-+-");
  const bodyLines = normalizedRows.map((row) => formatRow(row, widths));

  return [headerLine, dividerLine, ...bodyLines];
}

function formatRow(cells: string[], widths: number[]): string {
  return cells
    .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
    .join(" | ");
}

function sanitizeCell(value: string, maxWidth = 42): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxWidth) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxWidth - 3))}...`;
}

function splitMultiline(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line || " ");
}

function findSelectedHostIndex(hosts: HostConfigEntry[], lastSelectedHostAlias?: string): number {
  if (!lastSelectedHostAlias) {
    return 0;
  }

  const index = hosts.findIndex((host) => host.alias === lastSelectedHostAlias);
  return index >= 0 ? index : 0;
}

function formatBox(title: string, lines: string[]): string[] {
  const width = Math.max(title.length + 2, ...lines.map((line) => line.length), 0);
  const top = `┌─ ${title} ${"─".repeat(Math.max(0, width - title.length - 1))}┐`;
  const body = lines.map((line) => `│ ${line.padEnd(width)} │`);
  const bottom = `└${"─".repeat(width + 2)}┘`;
  return [top, ...body, bottom];
}

function formatColumns(left: string[], right: string[], gap = 4): string[] {
  const leftWidth = Math.max(0, ...left.map((line) => line.length));
  const rightWidth = Math.max(0, ...right.map((line) => line.length));
  const rowCount = Math.max(left.length, right.length);
  const lines: string[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const leftLine = left[index] ?? "";
    const rightLine = right[index] ?? "";
    lines.push(`${leftLine.padEnd(leftWidth)}${" ".repeat(gap)}${rightLine.padEnd(rightWidth)}`);
  }

  return lines;
}

void main();
