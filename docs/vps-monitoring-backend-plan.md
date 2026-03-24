# VPS Monitoring App - Headless Backend Plan

## Goal

Build a frontend-agnostic local backend that:

- Runs on the user's machine (Windows first)
- Uses system OpenSSH (`ssh`) and existing `.ssh/config`
- Connects via host aliases
- Collects VPS resource and Docker data
- Outputs normalized JSON
- Can later power Electron, web, CLI, or other transports

## Core Principles

- No UI first
- No custom SSH implementation
- No agents on VPS
- Only basic tools assumed on VPS
- Strict command-based data collection
- Strong typing and normalized output

## Architecture Overview

```text
[ CLI / HTTP API ]
        ↓
      core/
        ↓
  ┌───────────────┐
  │ SSH Executor  │ → system ssh
  ├───────────────┤
  │ Capability    │
  │ Probe         │
  ├───────────────┤
  │ Collectors    │
  │ (system/docker)
  ├───────────────┤
  │ Parsers       │
  ├───────────────┤
  │ Models        │
  └───────────────┘
```

## Tech Stack

- Node.js
- TypeScript
- `child_process.spawn` for SSH
- No frontend initially

Later evolution:

- CLI
- HTTP API
- Electron

## Project Structure

```text
apps/
  cli/
    commands/
  server/ (later)

packages/
  core/
    platform/
    ssh/
    probes/
    collectors/
    parsers/
    models/
    errors/
```

## Phase 1 - CLI Foundation

### Deliverable

A working CLI tool:

```bash
vpsmon list-hosts
vpsmon probe-host <alias>
vpsmon get-overview <alias>
vpsmon list-containers <alias>
vpsmon get-container <alias> <id>
vpsmon get-container-stats <alias>
```

All output must be JSON.

## Phase 2 - SSH Integration

### Module: `sshExecutor.ts`

Responsibilities:

- Spawn `ssh`
- Execute remote commands
- Capture stdout and stderr
- Timeout and cancellation
- Return structured result

### Pattern

```bash
ssh <alias> "<command>"
```

Do not resolve SSH config manually for execution.

## Phase 3 - SSH Config Discovery

### Source (Windows)

```text
%USERPROFILE%\.ssh\config
```

### Parse fields

- Host
- HostName
- User
- Port
- IdentityFile

### Output

```json
[
  {
    "alias": "prod",
    "hostname": "1.2.3.4",
    "user": "ubuntu",
    "port": 22
  }
]
```

## Phase 4 - Capability Probe

### Goal

Detect what features are available on the VPS.

### Commands

```bash
command -v docker
command -v systemctl
command -v journalctl
command -v ss
```

Also check:

- `/proc`
- shell access

### Output

```json
{
  "reachable": true,
  "capabilities": {
    "procfs": true,
    "docker": true,
    "systemd": false,
    "journalctl": false
  }
}
```

## Phase 5 - System Overview Collector

### Commands

```bash
hostname
uname -a
uptime
cat /proc/loadavg
cat /proc/meminfo
df -kP
ps aux
```

### Output

```json
{
  "host": {},
  "cpu": {},
  "memory": {},
  "filesystems": [],
  "topProcesses": []
}
```

### Notes

Always include:

- raw output
- parsed output
- warnings

## Phase 6 - Docker Collector

### Detection

```bash
command -v docker
```

### List Containers

```bash
docker ps -a --format ...
```

```json
[
  {
    "id": "...",
    "name": "...",
    "image": "...",
    "state": "...",
    "status": "...",
    "ports": []
  }
]
```

### Container Details

```bash
docker inspect <id>
```

```json
{
  "id": "...",
  "image": "...",
  "mounts": [],
  "networks": [],
  "restartPolicy": ""
}
```

### Stats (snapshot)

```bash
docker stats --no-stream
```

```json
{
  "cpuPercent": 0,
  "memoryUsageBytes": 0
}
```

## Phase 7 - Data Contract

### Success Response

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "host": "prod",
    "collectedAt": "ISO",
    "durationMs": 120
  },
  "warnings": []
}
```

### Error Response

```json
{
  "ok": false,
  "error": {
    "code": "SSH_TIMEOUT",
    "message": "Timed out"
  }
}
```

## Phase 8 - Platform Abstraction

### Interface

```ts
interface PlatformAdapter {
  getSshConfigPath(): string
  getSshBinary(): string
  spawn(): ChildProcess
}
```
### First implementation

- Windows only

Later:

- Linux
- macOS

## Phase 9 - Security Model

### Rules

- Use system ssh only
- No password storage
- No config mutation
- No arbitrary command execution

### API Safety

Allowed:

- typed commands only

Not allowed:

- raw shell execution

## Phase 10 - Transport Layer

### Step 1 (MVP)

CLI only

### Step 2

Local HTTP API

Endpoints:

```text
GET /hosts
GET /hosts/:alias/probe
GET /hosts/:alias/overview
GET /hosts/:alias/containers
GET /hosts/:alias/containers/:id
GET /hosts/:alias/stats
```

### Step 3

Electron app (optional)

## Data Models

### Host

```json
{
  "alias": "",
  "hostname": "",
  "user": ""
}
```

### Container

```json
{
  "id": "",
  "name": "",
  "image": "",
  "state": ""
}
```

### Stats

```json
{
  "cpuPercent": 0,
  "memoryUsageBytes": 0
}
```

## MVP Definition

Must support:

- SSH host discovery
- Connection test
- System overview
- Docker detection
- Container listing
- Container inspect
- Container stats (snapshot)
- JSON output

## Future Extensions

- logs (docker and journalctl)
- systemd services
- live streaming stats
- multi-host dashboards
- alerts
- caching layer

## Final Direction

Start with:

TypeScript core and CLI JSON interface

Then:

HTTP API and Electron frontend
