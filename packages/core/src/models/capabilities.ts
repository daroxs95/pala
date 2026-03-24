export interface CapabilityFlags {
  procfs: boolean;
  docker: boolean;
  systemd: boolean;
  journalctl: boolean;
  socketStats: boolean;
}

export interface HostProbeResult {
  reachable: boolean;
  shell: boolean;
  capabilities: CapabilityFlags;
  raw: Record<string, string>;
  warnings: string[];
}

