# TODO

## Current Focus

- [x] Initialize the repository and add base project metadata
- [x] Create a Bun monorepo with `apps/*` and `packages/*`
- [x] Add a strict TypeScript configuration shared across packages
- [x] Define the JSON response envelope and core domain models
- [x] Implement Windows platform adapter for ssh binary and ssh config path discovery
- [x] Implement SSH config reader/parser for host aliases
- [x] Implement typed ssh executor using `child_process.spawn`
- [x] Support both stateless and persistent SSH session modes
- [x] Implement `vpsmon list-hosts`
- [x] Implement `vpsmon probe-host <alias>`
- [x] Add typed command builders so collectors never assemble ad hoc shell strings
- [ ] Implement command-level tests for SSH config parsing and response shaping

## MVP Backlog

- [x] Add a barebones Bun TUI frontend prototype under `apps/tui`
- [x] Implement system overview collector
- [x] Implement parsers for `uptime`, `/proc/loadavg`, `/proc/meminfo`, `df -kP`, and `ps aux`
- [ ] Improve partial-result handling when overview collection times out mid-stream
- [ ] Implement Docker capability detection
- [ ] Implement container listing
- [ ] Implement container inspect
- [ ] Implement container stats snapshot
- [ ] Normalize success and error responses
- [ ] Add integration-style tests for parsing and command execution boundaries
- [ ] Document supported remote command assumptions

## Later

- [ ] Add local HTTP API package
- [ ] Add Electron frontend
- [ ] Add logs support for Docker and journald
- [ ] Add systemd service inspection
- [ ] Add live stats streaming
- [ ] Add caching layer
- [ ] Add alerts
