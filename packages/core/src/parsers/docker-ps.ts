import type { ContainerPortBinding, ContainerSummary } from "../models/container";

export function parseDockerPs(raw: string): ContainerSummary[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [id, name, image, state, status, portsText] = line.split("\t");
      if (!id || !name || !image || !state || !status) {
        return [];
      }

      return [{
        id,
        name,
        image,
        state,
        status,
        ports: parsePorts(portsText),
      }];
    });
}

function parsePorts(raw: string | undefined): ContainerPortBinding[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((port) => port.trim())
    .filter(Boolean)
    .map((port) => ({ raw: port }));
}

