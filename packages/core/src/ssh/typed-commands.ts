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
