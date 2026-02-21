export type RunCallbacks = {
  onBefore?: (cmd: string, index: number, total: number) => void;
  onSuccess?: () => void;
  onError?: (cmd: string, exitCode: number) => void;
};

/**
 * Run commands in series via sh -c, streaming stdout/stderr to the terminal.
 * Returns true if all commands exit 0, false on first non-zero exit.
 */
export async function runCommands(
  commands: string[],
  callbacks: RunCallbacks = {}
): Promise<boolean> {
  const total = commands.length;

  for (const [i, cmd] of commands.entries()) {
    callbacks.onBefore?.(cmd, i, total);

    const proc = Bun.spawn(['sh', '-c', cmd], {
      stdout: 'inherit',
      stderr: 'inherit',
    });

    await proc.exited;

    if (proc.exitCode !== 0) {
      callbacks.onError?.(cmd, proc.exitCode ?? 1);
      return false;
    }
  }

  callbacks.onSuccess?.();
  return true;
}
