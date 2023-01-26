const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Mapping from short to long temp directory paths (Windows only).
 * false indicates a previous unsuccessful attempt to calculate a long path.
 * (There will probably only ever be one value returned from `os.tmpdir()`, unless someone is
 * messing with environment variables, but this handles it regardless.)
 * @type {{ [path: string]: string | false | undefined }}
 */
let windowsLongTmpdirs = {};

function clearCache() {
  windowsLongTmpdirs = {};
}

/**
 * Supported on Windows only: expand an absolute path with short (8.3) segments to a long path.
 * If the user name is the only short segment, and `shortPath` is under `os.homedir()` (which must
 * not include any short segments), uses `os.homedir()` as a replacement for the short part.
 * Otherwise, expands each short segment of the path using `attrib.exe`.
 * @param {string} shortPath Absolute Windows path, possibly with one or more short (8.3) segments
 * @returns {string | false} Returns the expanded path, or false if not on Windows, it's an
 * unsupported type of path, or there's an error expanding any of the segments.
 */
function expandShortPath(shortPath) {
  if (os.platform() !== 'win32' || !/^[a-z]:\\/i.test(shortPath)) {
    return false; // wrong platform, or possibly a network, relative, or non-Windows path
  }
  if (!shortPath.includes('~')) {
    return shortPath; // not actually a short path
  }

  // First (to avoid spawning a process), try using os.homedir() to replace a short user directory
  // segment in shortPath. This only works if:
  // - shortPath is under the home directory
  // - the user directory name is the only short segment
  // - the home directory variable isn't defined with a short path
  //
  // 1 = path up to user directory, 2 = rest of path
  const userDirMatch = shortPath.match(/^([a-z]:\\Users\\[^\\]+)(.*)/i);
  if (userDirMatch && userDirMatch[1].includes('~') && !userDirMatch[2].includes('~')) {
    const homedir = os.homedir();
    // To verify that the short user directory part of shortPath is the home directory,
    // compare the inode numbers (pretty sure this will work).
    if (
      !homedir.includes('~') &&
      fs.existsSync(userDirMatch[1]) &&
      fs.statSync(userDirMatch[1]).ino === fs.statSync(homedir).ino
    ) {
      return shortPath.replace(userDirMatch[1], homedir);
    }
  }

  // Otherwise, (mis)use attrib.exe to expand the path: while its intended use is to get/set file
  // attributes, it also appears to always expand the last path segment into a long path.
  const segments = shortPath.split('\\');
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].includes('~')) {
      try {
        // Given input like C:\Users\VERYLO~1, attrib returns output like:
        //                    C:\Users\verylongusername
        // (possibly with one or more letters at the start indicating file/dir attributes)
        // But it will only expand the last segment in the path, so we need to iterate through.
        const partialShortPath = segments.slice(0, i + 1).join('\\');
        const attribResult = child_process
          .spawnSync('attrib.exe', [partialShortPath])
          .stdout.toString()
          .trim();

        // attrib doesn't exit with an error code for bad paths, so check for errors like:
        // File not found - C:\badname
        const expandedMatch = attribResult.match(/(?<!- )[a-z]:\\.*/i);

        if (
          expandedMatch &&
          path.dirname(expandedMatch[0].toLowerCase()) ===
            path.dirname(partialShortPath.toLowerCase())
        ) {
          segments[i] = path.basename(expandedMatch[0]);
        } else {
          // Bail on any issues to avoid inaccurate results
          return false;
        }
      } catch (err) {
        return false;
      }
    }
  }

  // one last check to make sure it's valid
  const result = segments.join('\\');
  return fs.existsSync(result) && result;
}

/**
 * Return a normalized path to the OS temp directory, working around Mac and Windows quirks
 * which can cause path comparison problems.
 * @param {import('./index.js').NormalizedTmpdirOptions} [options]
 * @returns {string}
 */
function normalizedTmpdir(options = {}) {
  const localConsole = options.console === true ? console : options.console;

  // For Mac: convert /var/... to /private/var/...
  let tmpdir = fs.realpathSync(os.tmpdir());

  // For Windows: if there's a short path segment, expand it
  if (os.platform() === 'win32' && tmpdir.includes('~')) {
    if (windowsLongTmpdirs[tmpdir] === undefined) {
      windowsLongTmpdirs[tmpdir] = expandShortPath(tmpdir);
    }

    tmpdir = windowsLongTmpdirs[tmpdir] || tmpdir;

    if (tmpdir.includes('~') && localConsole) {
      localConsole.warn(
        `⚠️⚠️⚠️\nWARNING: temp directory "${tmpdir}" contains a short (8.3) path segment which ` +
          `could not be expanded by available heuristics. This may cause issues with tests ` +
          `or utilities which rely on path comparisons.\n⚠️⚠️⚠️`
      );
    }
  }

  return tmpdir;
}

// Use only named exports for universal compatibility
module.exports = { expandShortPath, normalizedTmpdir, clearCache };
