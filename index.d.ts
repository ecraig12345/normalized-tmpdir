export interface NormalizedTmpdirOptions {
  /**
   * By default, the library does not log warnings if normalization fails. If this option is true,
   * log warnings to the default console. If a console object is provided, use it for logging
   * (useful if you're mocking the console in Jest but always want this error to be shown).
   */
  console?: boolean | Pick<typeof console, 'warn'>;
}

/**
 * Return a normalized path to the OS temp directory, working around Mac and Windows quirks
 * which can cause path comparison problems.
 */
export function normalizedTmpdir(options?: NormalizedTmpdirOptions): string;

/**
 * Expand a Windows path with short (8.3) segments to a long path. If the user name is the only
 * short segment, and `shortPath` is under `os.homedir()` (which must not be a short path), uses
 * `os.homedir()` to expand the path. Otherwise, uses `attrib.exe` to expand the path.
 * @param shortPath The path to expand
 * @returns The expanded path if successful, or false if there's an error processing any of
 * the segments (or for network paths).
 */
export function expandShortPath(shortPath: string): string | false;
