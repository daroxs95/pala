import blessed from "blessed";
import { loadTuiState, saveTuiState } from "./tui-state";
import { writeTuiDebugLog } from "./tui-debug-log";
import {
  closeSshConnection,
  collectRealtimeResources,
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
  type RealtimeResources,
  type ProcessSummary,
  type SshSessionMode,
  type SystemOverview,
  resolveSshConnectionOptions,
} from "@pala/core";

type FocusPane = "hosts" | "details" | "output" | "diagnostics";
type DetailTab = "overview" | "probe" | "containers" | "stats" | "resources";
type PasswordRetryAction = "probe" | "overview" | "containers" | "stats" | "resources";

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

interface RealtimeResourcesSnapshotState {
  alias: string;
  durationMs: number;
  result: RealtimeResources;
  sampledAt: number;
  cpuPeakPercent: number;
  memoryPeakPercent: number;
  topProcessPeak: ProcessSummary | null;
  samples: ResourceWindowSample[];
}

interface ResourceWindowSample {
  timestamp: number;
  cpuPercent: number;
  memoryPercent: number;
  topProcess: ProcessSummary | null;
}

interface AppState {
  hosts: HostConfigEntry[];
  selectedHostIndex: number;
  focus: FocusPane;
  activeTab: DetailTab;
  sshMode: SshSessionMode;
  hostPickerOpen: boolean;
  passwordModalOpen: boolean;
  logs: string[];
  diagnostics: string[];
  statusText: string;
  lastProbeByHost: Record<string, ProbeSnapshot>;
  lastOverviewByHost: Record<string, OverviewSnapshot>;
  lastContainersByHost: Record<string, ContainerSnapshot>;
  lastContainerStatsByHost: Record<string, ContainerStatsSnapshotState>;
  lastResourcesByHost: Record<string, RealtimeResourcesSnapshotState>;
  hostPasswordsByAlias: Record<string, string>;
  passwordPromptHostAlias: string | undefined;
  passwordRetryAction: PasswordRetryAction | undefined;
  passwordDraft: string;
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

const RESOURCE_POLL_INTERVAL_MS = 1_500;
const RESOURCE_PEAK_WINDOW_MS = 12_000;
const RESOURCE_METRIC_CARD_WIDTH = 56;
const RESOURCE_TOP_PROCESS_CARD_WIDTH = 116;

async function main(): Promise<void> {
  const platform = getDefaultPlatformAdapter();
  const persistedState = await loadTuiState();
  const state: AppState = {
    hosts: [],
    selectedHostIndex: 0,
    focus: "hosts",
    activeTab: isDetailTab(persistedState.lastActiveTab) ? persistedState.lastActiveTab : "overview",
    sshMode: "persistent",
    hostPickerOpen: true,
    passwordModalOpen: false,
    logs: [],
    diagnostics: [],
    statusText: "Loading hosts from ~/.ssh/config",
    lastProbeByHost: {},
    lastOverviewByHost: {},
    lastContainersByHost: {},
    lastContainerStatsByHost: {},
    lastResourcesByHost: {},
    hostPasswordsByAlias: {},
    passwordPromptHostAlias: undefined,
    passwordRetryAction: undefined,
    passwordDraft: "",
    ...(persistedState.lastSelectedHostAlias
      ? { lastSelectedHostAlias: persistedState.lastSelectedHostAlias }
      : {}),
    touchedPersistentHosts: new Set<string>(),
  };
  let resourcesPollTimer: ReturnType<typeof setTimeout> | undefined;
  let resourcesPollGeneration = 0;
  let resourcesPollInFlight = false;

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
    if (state.passwordModalOpen) {
      return;
    }
    state.hostPickerOpen = !state.hostPickerOpen;
    state.focus = state.hostPickerOpen ? "hosts" : "details";
    render();
  });

  screen.key(["escape"], () => {
    if (state.passwordModalOpen) {
      closePasswordModal("SSH password entry cancelled.");
      return;
    }
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
    keys: true,
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
    height: "66%-1",
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
    keys: true,
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
    top: "66%",
    left: 0,
    width: "68%",
    height: "33%-1",
    label: " Activity ",
    tags: true,
    border: "line",
    style: panelStyle(),
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    scrollbar: {
      ch: " ",
      style: {
        bg: palette.border,
      },
    },
  });

  const diagnosticsPanel = blessed.box({
    parent: screen,
    top: "66%",
    left: "68%",
    width: "32%",
    height: "33%-1",
    label: " Diagnostics ",
    tags: true,
    border: "line",
    style: panelStyle(),
    scrollable: true,
    alwaysScroll: true,
    keys: true,
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
      " {bold}h{/bold} hosts  {bold}tab{/bold} focus  {bold}p{/bold} password  {bold}1{/bold}/{bold}2{/bold}/{bold}3{/bold}/{bold}4{/bold}/{bold}5{/bold} tabs  {bold}enter{/bold} probe  {bold}o{/bold} overview  {bold}c{/bold} containers  {bold}s{/bold} stats  {bold}5{/bold} resources  {bold}m{/bold} mode  {bold}r{/bold} reload  {bold}q{/bold} quit ",
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

  const passwordModal = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "56%",
    height: 9,
    label: " SSH Password ",
    tags: true,
    border: "line",
    shadow: true,
    style: panelStyle(),
  });
  passwordModal.hide();

  const passwordHint = blessed.box({
    parent: passwordModal,
    top: 0,
    left: 1,
    width: "100%-4",
    height: 2,
    tags: true,
    style: {
      fg: palette.muted,
      bg: palette.panel,
    },
  });

  const passwordInput = blessed.box({
    parent: passwordModal,
    top: 3,
    left: 1,
    width: "100%-4",
    height: 1,
    tags: true,
    style: {
      fg: palette.text,
      bg: palette.background,
    },
  });

  const passwordFooter = blessed.box({
    parent: passwordModal,
    top: 5,
    left: 1,
    width: "100%-4",
    height: 1,
    tags: true,
    content: "{gray-fg}Enter to save, Esc to cancel{/gray-fg}",
    style: {
      fg: palette.muted,
      bg: palette.panel,
    },
  });

  screen.on("keypress", async (character, key) => {
    if (!state.passwordModalOpen) {
      return;
    }

    if (key.name === "enter") {
      await submitPasswordModal();
      return;
    }

    if (key.name === "escape") {
      closePasswordModal("SSH password entry cancelled.");
      return;
    }

    if (key.name === "backspace") {
      state.passwordDraft = state.passwordDraft.slice(0, -1);
      render();
      return;
    }

    if (!character || key.ctrl || key.meta) {
      return;
    }

    const sanitizedChunk = character.replace(/[\r\n]/g, "");
    if (/^[\x20-\x7E]+$/.test(sanitizedChunk)) {
      state.passwordDraft += sanitizedChunk;
      render();
    }
  });

  screen.key(["j", "down"], () => {
    if (state.passwordModalOpen) {
      return;
    }

    if (state.hostPickerOpen) {
      if (state.hosts.length === 0) {
        return;
      }

      state.selectedHostIndex = Math.min(state.selectedHostIndex + 1, state.hosts.length - 1);
      render();
      return;
    }

    scrollFocusedPanel(1);
    render();
  });

  screen.key(["k", "up"], () => {
    if (state.passwordModalOpen) {
      return;
    }

    if (state.hostPickerOpen) {
      if (state.hosts.length === 0) {
        return;
      }

      state.selectedHostIndex = Math.max(state.selectedHostIndex - 1, 0);
      render();
      return;
    }

    scrollFocusedPanel(-1);
    render();
  });

  screen.key(["pageup"], () => {
    if (state.passwordModalOpen || state.hostPickerOpen) {
      return;
    }

    scrollFocusedPanel(-8);
    render();
  });

  screen.key(["pagedown"], () => {
    if (state.passwordModalOpen || state.hostPickerOpen) {
      return;
    }

    scrollFocusedPanel(8);
    render();
  });

  screen.key(["tab"], () => {
    focusNextPane();
  });

  screen.key(["1"], async () => {
    if (state.passwordModalOpen) {
      return;
    }
    setActiveTab("overview");
    render();
    await refreshActiveTab();
  });

  screen.key(["2"], async () => {
    if (state.passwordModalOpen) {
      return;
    }
    setActiveTab("probe");
    render();
    await refreshActiveTab();
  });

  screen.key(["3"], async () => {
    if (state.passwordModalOpen) {
      return;
    }
    setActiveTab("containers");
    render();
    await refreshActiveTab();
  });

  screen.key(["4"], async () => {
    if (state.passwordModalOpen) {
      return;
    }
    setActiveTab("stats");
    render();
    await refreshActiveTab();
  });

  screen.key(["5"], async () => {
    if (state.passwordModalOpen) {
      return;
    }
    setActiveTab("resources");
    render();
    await refreshActiveTab();
  });

  screen.key(["r"], async () => {
    if (state.passwordModalOpen) {
      return;
    }
    await reloadHosts();
  });

  screen.key(["c"], async () => {
    if (state.passwordModalOpen) {
      return;
    }
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runContainers(selectedHost.alias);
  });

  screen.key(["s"], async () => {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost || state.hostPickerOpen || state.passwordModalOpen) {
      return;
    }

    await runContainerStats(selectedHost.alias);
  });

  screen.key(["m"], () => {
    if (state.passwordModalOpen) {
      return;
    }
    state.sshMode = state.sshMode === "stateless" ? "persistent" : "stateless";
    state.statusText = `SSH mode set to ${state.sshMode}`;
    appendLog(`ssh mode changed to ${state.sshMode}`);
    render();
  });

  screen.key(["enter"], async () => {
    if (state.passwordModalOpen) {
      await submitPasswordModal();
      return;
    }
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
    if (state.hostPickerOpen || state.passwordModalOpen) {
      return;
    }

    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    await runOverview(selectedHost.alias);
  });

  screen.key(["p"], async () => {
    if (state.passwordModalOpen) {
      closePasswordModal("SSH password entry cancelled.");
      return;
    }

    if (state.hostPickerOpen) {
      return;
    }

    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    openPasswordModal(selectedHost.alias);
  });

  hostsList.on("select", async (_, index) => {
    state.selectedHostIndex = index;
    render();
  });

  hostPickerList.on("select", async (_, index) => {
    state.selectedHostIndex = index;
    await selectCurrentHost();
  });

  hostsList.on("focus", () => {
    if (state.focus === "hosts") {
      return;
    }
    state.focus = "hosts";
    render();
  });
  detailBody.on("focus", () => {
    if (state.focus === "details") {
      return;
    }
    state.focus = "details";
    render();
  });
  outputPanel.on("focus", () => {
    if (state.focus === "output") {
      return;
    }
    state.focus = "output";
    render();
  });
  diagnosticsPanel.on("focus", () => {
    if (state.focus === "diagnostics") {
      return;
    }
    state.focus = "diagnostics";
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
    hostPickerList.setItems(hostItems);
    hostPickerList.select(state.selectedHostIndex);

    header.setContent(
      `{bold}pala{/bold}  ssh vps monitor  {gray-fg}host:${state.hosts[state.selectedHostIndex]?.alias ?? "-"}{/gray-fg}  {gray-fg}mode:${getSshSessionModeLabel(state.sshMode)}{/gray-fg}`,
    );
    detailPanel.setLabel(" Details ");
    detailTabs.setContent(formatDetailTabs(state.activeTab));
    detailBody.setContent(getDetailLines(state).join("\n"));
    outputPanel.setContent(state.logs.slice(-200).join("\n"));
    diagnosticsPanel.setContent(state.diagnostics.slice(-200).join("\n"));
    statusBar.setContent(` ${state.statusText} `);
    hostPicker.hidden = !state.hostPickerOpen;
    passwordModal.hidden = !state.passwordModalOpen;
    passwordHint.setContent(
      state.passwordPromptHostAlias
        ? `Host: {bold}${state.passwordPromptHostAlias}{/bold}\nEnter the SSH password and press Enter.`
        : "",
    );
    passwordInput.setContent(state.passwordDraft.length > 0 ? "*".repeat(state.passwordDraft.length) : " ");
    passwordFooter.setContent(
      `{gray-fg}Enter to save, Esc to cancel. Length: ${state.passwordDraft.length}{/gray-fg}`,
    );

    applyFocusState(hostsPanel, detailPanel, outputPanel, diagnosticsPanel, state.focus);
    if (state.hostPickerOpen) {
      hostPicker.setFront();
      hostPickerList.focus();
    }
    if (state.passwordModalOpen) {
      passwordModal.setFront();
      passwordInput.focus();
    }
    if (!state.hostPickerOpen && !state.passwordModalOpen) {
      focusPane(state.focus);
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
      appendDiagnostic("error", `ssh config: ${formatError(error)}`);
    }

    render();
  }

  async function selectCurrentHost(): Promise<void> {
    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost) {
      return;
    }

    state.lastSelectedHostAlias = selectedHost.alias;
    await persistTuiState();

    state.hostPickerOpen = false;
    state.focus = "details";
    state.statusText = `Selected host ${selectedHost.alias}`;
    appendLog(`selected host ${selectedHost.alias}`);
    render();

    if (state.activeTab === "resources") {
      await runResources(selectedHost.alias);
      return;
    }

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
      case "resources":
        await runResources(selectedHost.alias);
        return;
    }
  }

  async function runProbe(alias: string): Promise<void> {
    setActiveTab("probe");
    state.statusText = `Probing ${alias}`;
    appendLog(`probe started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await probeHost(
        platform,
        alias,
        10_000,
        buildConnectionOptions(alias),
      );
      state.lastProbeByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
      state.statusText = result.reachable
        ? `Probe succeeded for ${alias} in ${durationMs}ms`
        : `Probe finished with warnings for ${alias}`;
      appendLog(`probe finished for ${alias} in ${durationMs}ms`);
      if (result.warnings.length > 0) {
        appendWarnings(result.warnings);
        await maybePromptForPassword(alias, "probe", result.warnings);
      }
    } catch (error) {
      state.statusText = `Probe failed for ${alias}`;
      appendLog(`probe error for ${alias}: ${formatError(error)}`);
      appendDiagnostic("error", `probe ${alias}: ${formatError(error)}`);
      await maybePromptForPassword(alias, "probe", [formatError(error)]);
    }

    render();
  }

  async function runOverview(alias: string, silent = false): Promise<void> {
    setActiveTab("overview");
    state.statusText = `Collecting overview for ${alias}`;
    appendLog(silent ? `overview auto-refresh started for ${alias}` : `overview started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await collectSystemOverview(
        platform,
        alias,
        30_000,
        buildConnectionOptions(alias),
      );
      state.lastOverviewByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
      state.statusText = `Overview collected for ${alias} in ${durationMs}ms`;
      appendLog(`${silent ? "overview auto-refresh" : "overview"} finished for ${alias} in ${durationMs}ms`);
      appendWarnings(result.warnings);
      await maybePromptForPassword(alias, "overview", result.warnings);
    } catch (error) {
      state.statusText = `Overview failed for ${alias}`;
      appendLog(`overview error for ${alias}: ${formatError(error)}`);
      appendDiagnostic("error", `overview ${alias}: ${formatError(error)}`);
      await maybePromptForPassword(alias, "overview", [formatError(error)]);
    }

    render();
  }

  async function runContainers(alias: string): Promise<void> {
    setActiveTab("containers");
    state.statusText = `Listing containers for ${alias}`;
    appendLog(`container list started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await listContainers(
        platform,
        alias,
        20_000,
        buildConnectionOptions(alias),
      );
      state.lastContainersByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
      state.statusText = result.dockerAvailable
        ? `Listed ${result.containers.length} containers for ${alias} in ${durationMs}ms`
        : `Docker not available on ${alias}`;
      appendLog(`container list finished for ${alias} in ${durationMs}ms`);
      appendWarnings(result.warnings);
      await maybePromptForPassword(alias, "containers", result.warnings);
    } catch (error) {
      state.statusText = `Container listing failed for ${alias}`;
      appendLog(`container list error for ${alias}: ${formatError(error)}`);
      appendDiagnostic("error", `containers ${alias}: ${formatError(error)}`);
      await maybePromptForPassword(alias, "containers", [formatError(error)]);
    }

    render();
  }

  async function runContainerStats(alias: string): Promise<void> {
    setActiveTab("stats");
    state.statusText = `Collecting container stats for ${alias}`;
    appendLog(`container stats started for ${alias}`);
    render();

    try {
      const { result, durationMs } = await getContainerStats(
        platform,
        alias,
        20_000,
        buildConnectionOptions(alias),
      );
      state.lastContainerStatsByHost[alias] = { alias, result, durationMs };
      markPersistentHost(alias);
      state.statusText = result.dockerAvailable
        ? `Collected ${result.stats.length} container stats rows for ${alias} in ${durationMs}ms`
        : `Docker not available on ${alias}`;
      appendLog(`container stats finished for ${alias} in ${durationMs}ms`);
      appendWarnings(result.warnings);
      await maybePromptForPassword(alias, "stats", result.warnings);
    } catch (error) {
      state.statusText = `Container stats failed for ${alias}`;
      appendLog(`container stats error for ${alias}: ${formatError(error)}`);
      appendDiagnostic("error", `stats ${alias}: ${formatError(error)}`);
      await maybePromptForPassword(alias, "stats", [formatError(error)]);
    }

    render();
  }

  async function runResources(alias: string, silent = false): Promise<void> {
    if (resourcesPollInFlight) {
      return;
    }

    resourcesPollInFlight = true;
    setActiveTab("resources");
    clearResourcesPollTimer();
    if (!silent || !state.lastResourcesByHost[alias]) {
      state.statusText = `Collecting realtime resources for ${alias}`;
      appendLog(silent ? `resources auto-refresh started for ${alias}` : `resources started for ${alias}`);
    }
    render();

    try {
      const { result, durationMs } = await collectRealtimeResources(
        platform,
        alias,
        6_000,
        buildConnectionOptions(alias),
      );
      state.lastResourcesByHost[alias] = updateResourceSnapshot(
        state.lastResourcesByHost[alias],
        alias,
        result,
        durationMs,
      );
      markPersistentHost(alias);
      state.statusText = `Realtime resources collected for ${alias} in ${durationMs}ms`;
      if (!silent) {
        appendLog(`resources finished for ${alias} in ${durationMs}ms`);
      }
      appendWarnings(result.warnings);
      await maybePromptForPassword(alias, "resources", result.warnings);
    } catch (error) {
      state.statusText = `Realtime resources failed for ${alias}`;
      appendLog(`resources error for ${alias}: ${formatError(error)}`);
      appendDiagnostic("error", `resources ${alias}: ${formatError(error)}`);
      await maybePromptForPassword(alias, "resources", [formatError(error)]);
    } finally {
      resourcesPollInFlight = false;
    }

    if (state.activeTab === "resources") {
      scheduleResourcesPoll();
    }

    render();
  }

  function appendLog(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    state.logs.push(`[${timestamp}] ${message}`);
    void writeTuiDebugLog("activity", { message });
  }

  function appendDiagnostic(severity: "warning" | "error", message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    const color = severity === "error" ? "red-fg" : "yellow-fg";
    state.diagnostics.push(`[${timestamp}] {${color}}${severity.toUpperCase()}{/${color}} ${message}`);
    void writeTuiDebugLog("diagnostic", { severity, message });
  }

  function appendWarnings(messages: string[]): void {
    for (const message of messages) {
      appendDiagnostic("warning", message);
    }
  }

  function focusNextPane(): void {
    if (state.passwordModalOpen) {
      return;
    }

    if (state.hostPickerOpen) {
      hostPickerList.focus();
      render();
      return;
    }

    focusPane(nextFocus(state.focus));
    render();
  }

  function focusPane(pane: FocusPane): void {
    state.focus = pane;

    switch (pane) {
      case "hosts":
        hostsList.focus();
        return;
      case "details":
        detailBody.focus();
        return;
      case "output":
        outputPanel.focus();
        return;
      case "diagnostics":
        diagnosticsPanel.focus();
        return;
    }
  }

  function scrollFocusedPanel(delta: number): void {
    if (state.focus === "details") {
      detailBody.scroll(delta);
      return;
    }

    if (state.focus === "output") {
      outputPanel.scroll(delta);
      return;
    }

    if (state.focus === "diagnostics") {
      diagnosticsPanel.scroll(delta);
    }
  }

  function markPersistentHost(alias: string): void {
    if (state.sshMode === "persistent") {
      state.touchedPersistentHosts.add(alias);
    }
  }

  async function shutdown(): Promise<void> {
    cancelResourcesPolling();
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
        appendDiagnostic("error", `close ${hostAlias}: ${formatError(error)}`);
      }
    }

    screen.destroy();
    process.exit(0);
  }

  function buildConnectionOptions(alias: string) {
    const password = state.hostPasswordsByAlias[alias];
    return resolveSshConnectionOptions({
      mode: password ? "stateless" : state.sshMode,
      ...(password ? { password } : {}),
    });
  }

  function openPasswordModal(alias: string, retryAction?: PasswordRetryAction): void {
    state.passwordModalOpen = true;
    state.passwordPromptHostAlias = alias;
    state.passwordRetryAction = retryAction;
    state.passwordDraft = state.hostPasswordsByAlias[alias] ?? "";
    appendLog(`password modal opened for ${alias}${retryAction ? ` (${retryAction})` : ""}`);
    void writeTuiDebugLog("password-modal-opened", {
      hostAlias: alias,
      retryAction: retryAction ?? null,
      existingPasswordLength: state.passwordDraft.length,
    });
    render();
  }

  async function maybePromptForPassword(
    alias: string,
    retryAction: PasswordRetryAction,
    messages: string[],
  ): Promise<void> {
    if (state.hostPasswordsByAlias[alias]) {
      void writeTuiDebugLog("password-prompt-skipped", {
        hostAlias: alias,
        reason: "password already stored in memory",
      });
      return;
    }

    if (!messages.some((message) =>
      /permission denied|password|keyboard-interactive|persistent ssh session closed unexpectedly/i.test(message)
    )) {
      void writeTuiDebugLog("password-prompt-skipped", {
        hostAlias: alias,
        reason: "messages did not match password-auth pattern",
        messages,
      });
      return;
    }

    state.statusText = `SSH password required for ${alias}`;
    appendLog(`opening password prompt for ${alias}`);
    openPasswordModal(alias, retryAction);
  }

  function closePasswordModal(statusText?: string): void {
    state.passwordModalOpen = false;
    state.passwordPromptHostAlias = undefined;
    state.passwordRetryAction = undefined;
    state.passwordDraft = "";
    state.focus = "details";
    if (statusText) {
      state.statusText = statusText;
      appendLog(statusText);
    }
    render();
  }

  async function submitPasswordModal(): Promise<void> {
    if (!state.passwordModalOpen || !state.passwordPromptHostAlias) {
      appendLog("password modal submit ignored because no host was pending");
      void writeTuiDebugLog("password-modal-submit-ignored");
      return;
    }

    const alias = state.passwordPromptHostAlias;
    const password = state.passwordDraft;
    if (password.length === 0) {
      appendLog(`password modal submit rejected for ${alias}: empty password`);
      void writeTuiDebugLog("password-modal-submit-rejected", {
        hostAlias: alias,
        reason: "empty password",
      });
      closePasswordModal("SSH password cannot be empty.");
      return;
    }

    state.hostPasswordsByAlias[alias] = password;
    appendLog(`stored in-memory ssh password for ${alias} (length ${password.length})`);
    void writeTuiDebugLog("password-stored", {
      hostAlias: alias,
      passwordLength: password.length,
    });
    const retryAction = state.passwordRetryAction;
    closePasswordModal();
    if (retryAction) {
      appendLog(`retrying ${retryAction} for ${alias} with in-memory password`);
      void writeTuiDebugLog("password-retry-started", {
        hostAlias: alias,
        retryAction,
      });
      await rerunAction(alias, retryAction);
    } else {
      appendLog(`no retry action was pending for ${alias} after password submit`);
      void writeTuiDebugLog("password-retry-missing", {
        hostAlias: alias,
      });
    }
  }

  async function rerunAction(alias: string, action: PasswordRetryAction): Promise<void> {
    switch (action) {
      case "probe":
        await runProbe(alias);
        return;
      case "overview":
        await runOverview(alias);
        return;
      case "containers":
        await runContainers(alias);
        return;
      case "stats":
        await runContainerStats(alias);
        return;
      case "resources":
        await runResources(alias);
        return;
    }
  }

  function setActiveTab(nextTab: DetailTab): void {
    if (state.activeTab === nextTab) {
      return;
    }

    state.activeTab = nextTab;
    void persistTuiState();
    if (nextTab !== "resources") {
      cancelResourcesPolling();
    }
  }

  async function persistTuiState(): Promise<void> {
    await saveTuiState({
      ...(state.lastSelectedHostAlias ? { lastSelectedHostAlias: state.lastSelectedHostAlias } : {}),
      lastActiveTab: state.activeTab,
    });
  }

  function scheduleResourcesPoll(): void {
    if (state.activeTab !== "resources") {
      return;
    }

    clearResourcesPollTimer();
    const generation = resourcesPollGeneration;
    resourcesPollTimer = setTimeout(() => {
      void pollResources(generation);
    }, RESOURCE_POLL_INTERVAL_MS);
  }

  async function pollResources(generation: number): Promise<void> {
    resourcesPollTimer = undefined;
    if (generation !== resourcesPollGeneration || state.activeTab !== "resources") {
      return;
    }

    const selectedHost = state.hosts[state.selectedHostIndex];
    if (!selectedHost || state.hostPickerOpen || state.passwordModalOpen) {
      scheduleResourcesPoll();
      return;
    }

    await runResources(selectedHost.alias, true);
  }

  function cancelResourcesPolling(): void {
    resourcesPollGeneration += 1;
    clearResourcesPollTimer();
  }

  function clearResourcesPollTimer(): void {
    if (!resourcesPollTimer) {
      return;
    }

    clearTimeout(resourcesPollTimer);
    resourcesPollTimer = undefined;
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
  diagnosticsPanel: blessed.Widgets.BoxElement,
  focus: FocusPane,
): void {
  hostsPanel.style.border = { fg: palette.border };
  detailPanel.style.border = { fg: palette.border };
  outputPanel.style.border = { fg: palette.border };
  diagnosticsPanel.style.border = { fg: palette.border };
  if (focus === "hosts") {
    hostsPanel.style.border = { fg: palette.accent };
  }
  if (focus === "details") {
    detailPanel.style.border = { fg: palette.accent };
  }
  if (focus === "output") {
    outputPanel.style.border = { fg: palette.accent };
  }
  if (focus === "diagnostics") {
    diagnosticsPanel.style.border = { fg: palette.accent };
  }
  hostsPanel.style.label = { fg: focus === "hosts" ? palette.text : palette.muted, bold: true };
  detailPanel.style.label = { fg: focus === "details" ? palette.text : palette.muted, bold: true };
  outputPanel.style.label = { fg: focus === "output" ? palette.text : palette.muted, bold: true };
  diagnosticsPanel.style.label = { fg: focus === "diagnostics" ? palette.text : palette.muted, bold: true };
}

function nextFocus(current: FocusPane): FocusPane {
  switch (current) {
    case "hosts":
      return "details";
    case "details":
      return "output";
    case "output":
      return "diagnostics";
    case "diagnostics":
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
  const resources = activeTab === "resources"
    ? `{black-fg}{green-bg} 5 Resources {/green-bg}{/black-fg}`
    : `{black-fg}{white-bg} 5 Resources {/white-bg}{/black-fg}`;

  return `${overview}  ${probe}  ${containers}  ${stats}  ${resources}`;
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

  if (state.activeTab === "resources") {
    const snapshot = state.lastResourcesByHost[selectedHost.alias];
    if (snapshot) {
      return formatResources(snapshot.alias, snapshot);
    }

    return [
      `Host: ${selectedHost.alias}`,
      "",
      "Realtime resources have not been collected yet.",
      "Press 5 to start the live monitor.",
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

  const stdoutBox = formatBox(
    "Raw stdout",
    splitMultiline(result.raw.stdout || "<empty>"),
  );

  const stderrBox = formatBox(
    "Raw stderr",
    splitMultiline(result.raw.stderr || "<empty>"),
  );

  return [
    ...formatGridRows(
      [
        [summaryBox, capabilitiesBox],
        [stdoutBox, stderrBox],
      ],
      3,
    ),
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

  return [
    ...formatGridRows(
      [
        [leftTop, rightTop],
        [leftBottom, rightBottom],
        [fileSystemsBox, processesBox],
      ],
      3,
    ),
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

  return [
    ...summaryBox,
    "",
    ...containersBox,
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

  return [
    ...summaryBox,
    "",
    ...tableBox,
  ];
}

function formatResources(alias: string, snapshot: RealtimeResourcesSnapshotState): string[] {
  const { result, durationMs, sampledAt, cpuPeakPercent, memoryPeakPercent, topProcessPeak } = snapshot;
  const peakWindowLabel = formatPeakWindowLabel(RESOURCE_PEAK_WINDOW_MS);
  const cpuBoxBase = formatBox(
    "CPU Usage",
    formatHorizontalMeterCard(
      result.cpu.usagePercent,
      cpuPeakPercent,
      [
        `Live   ${result.cpu.usagePercent.toFixed(1)}%`,
        `Peak   ${cpuPeakPercent.toFixed(1)}% (${peakWindowLabel})`,
        `Window ${result.cpu.sampleWindowMs}ms`,
      ],
    ),
  );

  const memoryBoxBase = formatBox(
    "RAM Usage",
    formatHorizontalMeterCard(
      result.memory.usedPercent,
      memoryPeakPercent,
      [
        `Live   ${result.memory.usedPercent.toFixed(1)}%`,
        `Peak   ${memoryPeakPercent.toFixed(1)}% (${peakWindowLabel})`,
        `Used   ${formatBytes(result.memory.usedBytes)}`,
        `Avail  ${formatBytes(result.memory.availableBytes)}`,
      ],
    ),
  );
  const metricCardWidth = Math.max(
    RESOURCE_METRIC_CARD_WIDTH,
    ...cpuBoxBase.map((line) => visibleLength(line)),
    ...memoryBoxBase.map((line) => visibleLength(line)),
  );
  const cpuBox = resizeBoxCard(cpuBoxBase, metricCardWidth, 0);
  const memoryBox = resizeBoxCard(memoryBoxBase, metricCardWidth, 0);

  const overviewBox = formatBox(
    "Realtime Pulse",
    [
      `Host      ${alias}`,
      `Updated   ${formatAge(sampledAt)}`,
      `Fetch     ${durationMs}ms`,
      `Peak win  ${peakWindowLabel}`,
      `State     ${result.warnings.length > 0 ? "warning" : "steady"}`,
    ],
  );

  const detailBox = formatBox(
    "Memory Detail",
    [
      `Total   ${formatBytes(result.memory.totalBytes)}`,
      `Free    ${formatBytes(result.memory.freeBytes)}`,
      `Cached  ${formatBytes(result.memory.cachedBytes)}`,
      `Buffer  ${formatBytes(result.memory.buffersBytes)}`,
    ],
  );

  const topProcessBox = resizeBoxCard(formatBox(
    "Top CPU Process",
    [
      ...formatProcessLine("Now", result.topProcess),
      "",
      ...formatProcessLine(`Peak ${peakWindowLabel}`, topProcessPeak),
    ],
  ), RESOURCE_TOP_PROCESS_CARD_WIDTH, 0);

  return [
    ...formatGridRows(
      [
        [cpuBox, memoryBox],
        [overviewBox, detailBox],
      ],
      3,
    ),
    "",
    ...topProcessBox,
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

function updateResourceSnapshot(
  previous: RealtimeResourcesSnapshotState | undefined,
  alias: string,
  result: RealtimeResources,
  durationMs: number,
): RealtimeResourcesSnapshotState {
  const sampledAt = Date.now();
  const samples = [
    ...(previous?.samples ?? []),
    {
      timestamp: sampledAt,
      cpuPercent: result.cpu.usagePercent,
      memoryPercent: result.memory.usedPercent,
      topProcess: result.topProcess,
    },
  ].filter((sample) => sampledAt - sample.timestamp <= RESOURCE_PEAK_WINDOW_MS);
  const topCpuPeakSample = findPeakSample(samples, "cpuPercent");
  const topMemoryPeakSample = findPeakSample(samples, "memoryPercent");
  const topProcessPeak = findTopProcessPeakSample(samples)?.topProcess ?? null;

  return {
    alias,
    durationMs,
    result,
    sampledAt,
    cpuPeakPercent: topCpuPeakSample?.cpuPercent ?? result.cpu.usagePercent,
    memoryPeakPercent: topMemoryPeakSample?.memoryPercent ?? result.memory.usedPercent,
    topProcessPeak,
    samples,
  };
}

function findPeakSample(
  samples: ResourceWindowSample[],
  key: "cpuPercent" | "memoryPercent",
): ResourceWindowSample | undefined {
  return samples.reduce<ResourceWindowSample | undefined>((peak, sample) => {
    if (!peak || sample[key] > peak[key]) {
      return sample;
    }

    return peak;
  }, undefined);
}

function findTopProcessPeakSample(samples: ResourceWindowSample[]): ResourceWindowSample | undefined {
  return samples.reduce<ResourceWindowSample | undefined>((peak, sample) => {
    const sampleCpu = sample.topProcess?.cpuPercent ?? -1;
    const peakCpu = peak?.topProcess?.cpuPercent ?? -1;
    if (!peak || sampleCpu > peakCpu) {
      return sample;
    }

    return peak;
  }, undefined);
}

function formatHorizontalMeterCard(currentPercent: number, peakPercent: number, detailLines: string[]): string[] {
  return [
    ...renderHorizontalMeter(currentPercent, peakPercent),
    "",
    ...detailLines,
  ];
}

function renderHorizontalMeter(currentPercent: number, peakPercent: number): string[] {
  const meterWidth = 30;
  const clampedCurrent = Math.max(0, Math.min(100, currentPercent));
  const clampedPeak = Math.max(clampedCurrent, Math.min(100, peakPercent));
  const filledSegments = Math.round((clampedCurrent / 100) * meterWidth);
  const peakSegments = Math.round((clampedPeak / 100) * meterWidth);
  const liveParts: string[] = [];
  const peakParts: string[] = [];

  for (let index = 0; index < meterWidth; index += 1) {
    if (index < peakSegments) {
      peakParts.push(colorizeHorizontalTrail(index, meterWidth));
    } else {
      peakParts.push("{gray-fg}·{/gray-fg}");
    }

    if (index < filledSegments) {
      liveParts.push(colorizeHorizontalFill(index, meterWidth));
    } else {
      liveParts.push("{gray-fg}·{/gray-fg}");
    }
  }

  return [
    `Peak   ${peakParts.join("")} {white-fg}${clampedPeak.toFixed(1).padStart(5)}%{/white-fg}`,
    `Live   ${liveParts.join("")} {bold}${clampedCurrent.toFixed(1).padStart(5)}%{/bold}`,
  ];
}

function colorizeHorizontalTrail(index: number, meterWidth: number): string {
  const ratio = (index + 1) / Math.max(1, meterWidth);
  if (ratio >= 0.82) {
    return "{red-fg}▎{/red-fg}";
  }

  if (ratio >= 0.58) {
    return "{yellow-fg}▎{/yellow-fg}";
  }

  return "{cyan-fg}▎{/cyan-fg}";
}

function colorizeHorizontalFill(index: number, meterWidth: number): string {
  const ratio = (index + 1) / Math.max(1, meterWidth);
  if (ratio >= 0.82) {
    return "{red-fg}▎{/red-fg}";
  }

  if (ratio >= 0.58) {
    return "{yellow-fg}▎{/yellow-fg}";
  }

  return "{green-fg}▎{/green-fg}";
}

function formatProcessLine(label: string, process: ProcessSummary | null): string[] {
  if (!process) {
    return [`${label.padEnd(13)} none`];
  }

  return [
    `${label.padEnd(13)} ${sanitizeCell(process.command, 68)}`,
    `${" ".repeat(13)} cpu ${process.cpuPercent.toFixed(1)}%  pid ${process.pid}  user ${process.user}`,
  ];
}

function formatPeakWindowLabel(windowMs: number): string {
  return `${Math.round(windowMs / 1_000)}s`;
}

function formatAge(timestampMs: number): string {
  const deltaMs = Math.max(0, Date.now() - timestampMs);
  if (deltaMs < 1_000) {
    return "just now";
  }

  return `${(deltaMs / 1_000).toFixed(1)}s ago`;
}

function isDetailTab(value: string | undefined): value is DetailTab {
  return value === "overview"
    || value === "probe"
    || value === "containers"
    || value === "stats"
    || value === "resources";
}

function findSelectedHostIndex(hosts: HostConfigEntry[], lastSelectedHostAlias?: string): number {
  if (!lastSelectedHostAlias) {
    return 0;
  }

  const index = hosts.findIndex((host) => host.alias === lastSelectedHostAlias);
  return index >= 0 ? index : 0;
}

function formatBox(title: string, lines: string[]): string[] {
  const width = Math.max(title.length + 2, ...lines.map((line) => visibleLength(line)), 0);
  const top = `┌─ ${title} ${"─".repeat(Math.max(0, width - title.length - 1))}┐`;
  const body = lines.map((line) => `│ ${padDisplayText(line, width)} │`);
  const bottom = `└${"─".repeat(width + 2)}┘`;
  return [top, ...body, bottom];
}

function formatColumns(left: string[], right: string[], gap = 4): string[] {
  return formatGrid([left, right], 2, gap);
}

function formatGrid(cards: string[][], columns = 2, gap = 4): string[] {
  const rows: string[][][] = [];

  for (let index = 0; index < cards.length; index += Math.max(1, columns)) {
    rows.push(cards.slice(index, index + Math.max(1, columns)));
  }

  return formatGridRows(rows, gap);
}

function formatGridRows(rows: string[][][], gap = 4): string[] {
  if (rows.length === 0) {
    return [];
  }

  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const columnWidths = Array.from({ length: maxColumns }, (_, columnIndex) =>
    Math.max(
      0,
      ...rows
        .flatMap((row) => {
          const card = row[columnIndex];
          return card ? card.map((line) => visibleLength(line)) : [0];
        }),
    )
  );
  const rendered: string[] = [];

  for (const row of rows) {
    const rowHeight = Math.max(0, ...row.map((card) => card.length));
    const paddedCards = row.length === 1 && maxColumns > 1
      ? [padCard(row[0] ?? [], columnWidths.reduce((sum, width) => sum + width, 0) + gap * (maxColumns - 1), rowHeight)]
      : row.map((card, columnIndex) => padCard(card, columnWidths[columnIndex] ?? 0, rowHeight));

    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      rendered.push(
        paddedCards
          .map((card, columnIndex) => card[lineIndex] ?? " ".repeat(columnWidths[columnIndex] ?? 0))
          .join(" ".repeat(gap)),
      );
    }
  }

  return rendered;
}

function formatGridLegacy(cards: string[][], columns = 2, gap = 4): string[] {
  if (cards.length === 0) {
    return [];
  }

  const normalizedColumns = Math.max(1, columns);
  const columnWidths = Array.from({ length: normalizedColumns }, (_, columnIndex) =>
    Math.max(
      0,
      ...cards
        .filter((_, cardIndex) => cardIndex % normalizedColumns === columnIndex)
        .flatMap((card) => card.map((line) => visibleLength(line))),
    )
  );
  const rows: string[] = [];

  for (let index = 0; index < cards.length; index += normalizedColumns) {
    const rowCards = cards.slice(index, index + normalizedColumns);
    const rowHeight = Math.max(0, ...rowCards.map((card) => card.length));
    const paddedCards = rowCards.map((card, rowIndex) => padCard(card, columnWidths[rowIndex] ?? 0, rowHeight));

    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      rows.push(
        paddedCards
          .map((card, rowIndex) => card[lineIndex] ?? " ".repeat(columnWidths[rowIndex] ?? 0))
          .join(" ".repeat(gap)),
      );
    }
  }

  return rows;
}

function padCard(card: string[], width: number, height: number): string[] {
  if (isBoxCard(card)) {
    return resizeBoxCard(card, width, height);
  }

  const normalized = card.map((line) => padDisplayText(line, width));
  while (normalized.length < height) {
    normalized.push(" ".repeat(width));
  }

  return normalized;
}

function isBoxCard(card: string[]): boolean {
  if (card.length < 2) {
    return false;
  }

  const top = card[0] ?? "";
  const bottom = card[card.length - 1] ?? "";
  return top.startsWith("┌") && top.endsWith("┐") && bottom.startsWith("└") && bottom.endsWith("┘");
}

function resizeBoxCard(card: string[], width: number, height: number): string[] {
  const top = widenBoxBorder(card[0] ?? "", width, "┐");
  const bottom = widenBoxBorder(card[card.length - 1] ?? "", width, "┘");
  const bodyLines = card.slice(1, -1).map((line) => widenBoxBody(line, width));
  const resized = [top, ...bodyLines];

  while (resized.length < Math.max(1, height - 1)) {
    resized.push(emptyBoxBody(width));
  }

  resized.push(bottom);
  return resized;
}

function widenBoxBorder(line: string, width: number, endChar: "┐" | "┘"): string {
  const diff = Math.max(0, width - visibleLength(line));
  if (diff === 0) {
    return line;
  }

  return `${line.slice(0, -1)}${"─".repeat(diff)}${endChar}`;
}

function widenBoxBody(line: string, width: number): string {
  if (!(line.startsWith("│ ") && line.endsWith(" │"))) {
    return padDisplayText(line, width);
  }

  const content = line.slice(2, -2);
  const innerWidth = Math.max(0, width - 4);
  return `│ ${padDisplayText(content, innerWidth)} │`;
}

function emptyBoxBody(width: number): string {
  const innerWidth = Math.max(0, width - 4);
  return `│ ${" ".repeat(innerWidth)} │`;
}

function visibleLength(value: string): number {
  return value.replace(/\{\/?[-\w]+\}/g, "").length;
}

function padDisplayText(value: string, width: number): string {
  const paddingWidth = Math.max(0, width - visibleLength(value));
  return `${value}${" ".repeat(paddingWidth)}`;
}

void main();
