export function buildProbeCommand(): string {
  return [
    "printf 'shell=1\\n'",
    "if [ -d /proc ]; then printf 'procfs=1\\n'; else printf 'procfs=0\\n'; fi",
    "if command -v docker >/dev/null 2>&1; then printf 'docker=1\\n'; else printf 'docker=0\\n'; fi",
    "if command -v systemctl >/dev/null 2>&1; then printf 'systemd=1\\n'; else printf 'systemd=0\\n'; fi",
    "if command -v journalctl >/dev/null 2>&1; then printf 'journalctl=1\\n'; else printf 'journalctl=0\\n'; fi",
    "if command -v ss >/dev/null 2>&1; then printf 'socketStats=1\\n'; else printf 'socketStats=0\\n'; fi",
  ].join("; ");
}

export function buildSystemOverviewCommand(): string {
  const sections = [
    ["hostname", "hostname"],
    ["uname", "uname -a"],
    ["uptime", "uptime"],
    ["loadavg", "cat /proc/loadavg"],
    ["meminfo", "cat /proc/meminfo"],
    ["df", "df -kP"],
    // Pull only the hottest processes to keep the overview response bounded.
    ["ps", "ps aux --sort=-%cpu | head -n 6"],
  ] as const;

  return sections
    .map(([name, command]) => `printf '__PALA__${name}__\\n'; ${command}`)
    .join("; ");
}

export function buildRealtimeResourcesCommand(): string {
  return [
    "printf '__PALA__statBefore__\\n'",
    "awk '/^cpu / { print; exit }' /proc/stat",
    "sleep 0.4",
    "printf '__PALA__statAfter__\\n'",
    "awk '/^cpu / { print; exit }' /proc/stat",
    "printf '__PALA__meminfo__\\n'",
    "cat /proc/meminfo",
    "printf '__PALA__topProcess__\\n'",
    // Keep this narrow to reduce sampler overhead on the host.
    "ps -eo user,pid,pcpu,pmem,comm --sort=-pcpu | head -n 4",
  ].join("; ");
}

export function buildDockerListContainersCommand(): string {
  return [
    "if ! command -v docker >/dev/null 2>&1; then",
    "printf '__PALA_DOCKER_MISSING__\\n';",
    "else",
    "printf '__PALA_DOCKER_OK__\\n';",
    "docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Status}}\\t{{.Ports}}';",
    "fi",
  ].join(" ");
}

export function buildDockerStatsCommand(): string {
  return [
    "if ! command -v docker >/dev/null 2>&1; then",
    "printf '__PALA_DOCKER_MISSING__\\n';",
    "else",
    "printf '__PALA_DOCKER_OK__\\n';",
    "docker stats --no-stream --format '{{.Container}}\\t{{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.NetIO}}\\t{{.BlockIO}}\\t{{.PIDs}}';",
    "fi",
  ].join(" ");
}
