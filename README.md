# pala

Small SSH-based VPS monitor.

It has:
- a CLI
- a TUI for host overview, probe, containers, stats, and realtime resources

## Requirements

- [Bun](https://bun.sh/)
- SSH access to the hosts you want to inspect
- an SSH config in the usual location (`~/.ssh/config`)

## Install

Clone the repo, then install dependencies:

```bash
bun install
```

Optional check:

```bash
bun run typecheck
```

## Run

CLI:

```bash
bun run vpsmon
```

TUI:

```bash
bun run vpsmon:tui
```

## Notes

- The TUI reads hosts from your SSH config.
- The realtime resources view polls only while that tab is active.
- This project uses Bun workspaces.
