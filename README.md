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

Direct TUI command after linking:

```bash
pala
```

## Put `pala` in PATH

The TUI package exposes a `pala` command.

From [apps/tui](D:/work/mine/pala/apps/tui), run:

```bash
bun link
```

After that, `pala` should be available in your shell.

If you want to remove it later:

```bash
bun unlink
```

The CLI package exposes a `palacli` command.

From [apps/cli](D:/work/mine/pala/apps/cli), run:

```bash
bun link
```

After that, `palacli` should be available in your shell.

## Notes

- The TUI reads hosts from your SSH config.
- The realtime resources view polls only while that tab is active.
- This project uses Bun workspaces.
