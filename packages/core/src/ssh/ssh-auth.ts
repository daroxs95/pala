// TODO WARN: Password-auth support was removed because the non-interactive
// SSH_ASKPASS approach was not reliable in this environment.
// Re-introduce password-auth with a PTY-backed ssh transport instead.

export async function buildSshAuthEnvironment(): Promise<NodeJS.ProcessEnv | undefined> {
  return undefined;
}
