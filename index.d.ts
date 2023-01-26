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
 * Supported on Windows only: expand an absolute path with short (8.3) segments to a long path.
 * If the user name is the only short segment, and `shortPath` is under `os.homedir()` (which must
 * not include any short segments), uses `os.homedir()` as a replacement for the short part.
 * Otherwise, expands each short segment of the path using `attrib.exe`.
 * @param shortPath Absolute Windows path, possibly with one or more short (8.3) segments
 * @returns Returns the expanded path, or false if not on Windows, it's an unsupported type of path,
 * or there's an error expanding any of the segments.
 */
export function expandShortPath(shortPath: string): string | false;
