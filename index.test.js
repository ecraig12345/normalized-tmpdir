const { describe, it, jest, afterEach, expect, beforeAll, afterAll } = require('@jest/globals');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rimraf = require('rimraf').sync;

const { expandShortPath, normalizedTmpdir, clearCache } =
  /** @type {import('./index.d') & { clearCache: () => void }} */ (require('./index'));

const paths = {
  homeDir: 'C:\\Users\\VeryLongName',
  shortTemp: 'C:\\Users\\VERYLO~1\\AppData\\Local\\Temp',
  longTemp: 'C:\\Users\\VeryLongName\\AppData\\Local\\Temp',
  weirdShortTemp: 'D:\\VERYLO~1\\Temp',
  weirdLongTemp: 'D:\\VeryLongName\\Temp',
  veryWeirdShortTemp: 'D:\\VERYLO~1\\EXTRAS~1\\Temp',
  veryWeirdLongTemp: 'D:\\VeryLongName\\ExtraStuff\\Temp',
  homeWeirdShortTemp: 'C:\\Users\\VERYLO~1\\EXTRAS~1\\Temp',
  homeWeirdLongTemp: 'C:\\Users\\VeryLongName\\ExtraStuff\\Temp',
};
const noOp = (/** @type {*} */ val) => val;
const throwError = () => {
  throw new Error('Unexpected call');
};

/** Emulate the actual result format of `attrib` */
const attribResult = (/** @type {string} */ str) =>
  /** @type {*} */ ({ stdout: ' '.repeat(19) + str + '\r\n' });

function windowsMocks() {
  if (os.platform() !== 'win32') {
    // mocking these on windows causes an infinite loop
    jest.spyOn(path, 'dirname').mockImplementation(path.win32.dirname);
    jest.spyOn(path, 'basename').mockImplementation(path.win32.basename);
  }

  return {
    spawnSync: jest.spyOn(child_process, 'spawnSync').mockImplementation(throwError),
    existsSync: jest.spyOn(fs, 'existsSync').mockImplementation(() => true),
    realpathSync: jest.spyOn(fs, 'realpathSync').mockImplementation(noOp),
    statSync: jest.spyOn(fs, 'statSync').mockImplementation(() => /** @type {*} */ ({ ino: 1 })),
    homedir: jest.spyOn(os, 'homedir').mockImplementation(() => paths.homeDir),
    platform: jest.spyOn(os, 'platform').mockImplementation(() => 'win32'),
    tmpdir: jest.spyOn(os, 'tmpdir').mockImplementation(() => paths.shortTemp),
  };
}

function throwMocks() {
  const mocks = windowsMocks();
  Object.values(mocks).forEach((mock) => mock.mockImplementation(throwError));
  jest.spyOn(os, 'platform').mockImplementation(() => 'win32');
}

/** Windows only: get the actual short name of a file/directory */
function getShortName(/** @type {string} */ dir) {
  const res = child_process.spawnSync('cmd', ['/s', '/c', `for %A in ("${dir}") do @echo %~sA`], {
    shell: true,
  });
  if (res.status !== 0) {
    throw new Error(`Could not get short name of ${dir}: ${res.stderr.toString()}`);
  }
  return res.stdout.toString().trim();
}

describe('expandShortPath', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns false for non-windows platforms', () => {
    throwMocks();
    jest.spyOn(os, 'platform').mockImplementation(() => 'linux');
    expect(expandShortPath(paths.shortTemp)).toBe(false);
  });

  it('returns false for unsupported paths', () => {
    throwMocks();
    expect(expandShortPath('')).toBe(false);
    expect(expandShortPath('/foo/bar')).toBe(false);
    expect(expandShortPath('\\\\foo\\bar')).toBe(false);
    expect(expandShortPath('foo\\bar')).toBe(false);
    expect(expandShortPath('.\\foo\\bar')).toBe(false);
  });

  it('does no extra calculations for long paths', () => {
    throwMocks();
    expect(expandShortPath('C:\\')).toBe('C:\\');
    expect(expandShortPath(paths.longTemp)).toBe(paths.longTemp);
  });

  it('uses os.homedir() as replacement if possible', () => {
    const mocks = windowsMocks();
    mocks.homedir.mockImplementation(() => paths.homeDir);

    expect(expandShortPath(paths.shortTemp)).toBe(paths.longTemp);
    expect(mocks.homedir).toHaveBeenCalledTimes(1);
  });

  it('does not use os.homedir() if inodes do not match', () => {
    const mocks = windowsMocks();
    mocks.statSync
      .mockImplementationOnce(() => /** @type {*} */ ({ ino: 1 }))
      .mockImplementationOnce(() => /** @type {*} */ ({ ino: 2 }));

    // this will fall back to the "attrib" method, which hasn't been configured and will throw
    expect(expandShortPath(paths.shortTemp)).toBe(false);
    expect(mocks.statSync).toHaveBeenCalledTimes(2);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
  });

  it('uses "attrib" to find the long path', () => {
    const mocks = windowsMocks();
    mocks.spawnSync
      .mockImplementationOnce(() => attribResult(path.win32.dirname(paths.weirdLongTemp)))
      .mockImplementation(throwError);

    expect(expandShortPath(paths.weirdShortTemp)).toBe(paths.weirdLongTemp);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
  });

  it('uses "attrib" to find long path with multiple short segments', () => {
    const mocks = windowsMocks();
    mocks.spawnSync
      .mockImplementationOnce(() =>
        attribResult(path.win32.dirname(path.win32.dirname(paths.veryWeirdLongTemp)))
      )
      .mockImplementationOnce(() => attribResult(path.win32.dirname(paths.veryWeirdLongTemp)))
      .mockImplementation(throwError);

    expect(expandShortPath(paths.veryWeirdShortTemp)).toBe(paths.veryWeirdLongTemp);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(2);
  });

  it('uses "attrib" to find long path under home directory with multiple short segments', () => {
    const mocks = windowsMocks();
    mocks.spawnSync
      .mockImplementationOnce(() =>
        attribResult(path.win32.dirname(path.win32.dirname(paths.homeWeirdLongTemp)))
      )
      .mockImplementationOnce(() => attribResult(path.win32.dirname(paths.homeWeirdLongTemp)))
      .mockImplementation(throwError);

    expect(expandShortPath(paths.homeWeirdShortTemp)).toBe(paths.homeWeirdLongTemp);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(2);
  });

  it('returns false if "attrib" returns an error', () => {
    const mocks = windowsMocks();
    mocks.spawnSync.mockImplementation(
      () => /** @type {*} */ ({ stdout: `File not found - D:\\whatever` })
    );

    expect(expandShortPath(paths.weirdShortTemp)).toBe(false);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
  });

  const windowsDescribe = os.platform() === 'win32' ? describe : describe.skip;
  windowsDescribe('windows (real filesystem)', () => {
    let testRoot = '';
    let tempDirs = /** @type {string[]} */ ([]);

    beforeAll(() => {
      testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'normalized-tmpdir-'));
    });

    afterAll(() => {
      rimraf(testRoot);
    });

    afterEach(() => {
      tempDirs.forEach((dir) => rimraf(dir));
      tempDirs = [];
    });

    // test home directory expansion for real if possible
    (/^[a-z]:\\Users\\[^~\\]{9,}$/.test(os.homedir()) ? it : it.skip)(
      'expands short home directory',
      () => {
        const spawnSpy = jest.spyOn(child_process, 'spawnSync');
        const shortName = getShortName(os.homedir());
        expect(shortName).toMatch(/~/);
        expect(expandShortPath(shortName)).toBe(os.homedir());
        expect(spawnSpy).not.toHaveBeenCalled();
      }
    );

    it.each([
      { long: 'foo bar baz', short: 'FOOBAR~1' },
      { long: 'foo^bar^baz', short: 'FOO^BA~1' },
      { long: 'foo%bar%baz', short: 'FOO%BA~1' },
      // this relies on the first directory already being created
      { long: 'foo bar baz\\very long name', short: 'FOOBAR~1\\VERYLO~1' },
    ])('expands "$short" ("$long") using attrib', ({ long, short }) => {
      const longPath = path.join(testRoot, long);
      const shortPath = path.join(testRoot, short);
      fs.mkdirSync(longPath);
      expect(fs.existsSync(shortPath)).toBe(true);

      const spawnSpy = jest.spyOn(child_process, 'spawnSync');
      const expanded = expandShortPath(shortPath);
      expect(expanded).toBeTruthy();
      expect(expanded).not.toMatch(/~/);
      expect(fs.statSync(String(expanded)).ino).toBe(fs.statSync(longPath).ino);
      expect(spawnSpy).toHaveBeenCalled();
    });
  });
});

describe('normalizedTmpdir', function () {
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  it('returns a real path', () => {
    // this is intentionally specific to the OS the test is running on
    const tmpdir = normalizedTmpdir();
    expect(tmpdir).toEqual(fs.realpathSync(tmpdir));
  });

  it('does not attempt to expand long paths', () => {
    const mocks = windowsMocks();
    mocks.tmpdir.mockImplementation(() => paths.longTemp);

    expect(normalizedTmpdir()).toEqual(paths.longTemp);
    // expandShortPath would call this function
    expect(mocks.homedir).not.toHaveBeenCalled();
  });

  it('caches return values', () => {
    const mocks = windowsMocks();

    const tmpdir = normalizedTmpdir();
    expect(tmpdir).toEqual(paths.longTemp);
    // expandShortPath should have called this function
    expect(mocks.homedir).toHaveBeenCalledTimes(1);

    expect(normalizedTmpdir()).toEqual(paths.longTemp);
    // should not call it again due to cache
    expect(mocks.homedir).toHaveBeenCalledTimes(1);
  });

  it('on failure, does not recalculate', () => {
    const mocks = windowsMocks();
    // cause homedir comparison to fail
    mocks.statSync.mockImplementationOnce(() => /** @type {*} */ ({ ino: 2 }));

    expect(normalizedTmpdir()).toBe(paths.shortTemp);
    expect(mocks.spawnSync).toHaveBeenCalled(); // verify it went to failure path

    // try again and verify it doesn't call spawnSync again
    mocks.spawnSync.mockClear();
    expect(normalizedTmpdir()).toBe(paths.shortTemp);
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

  it('on failure, does not log by default', () => {
    const logSpy = jest.spyOn(console, 'warn').mockImplementation(noOp);
    const mocks = windowsMocks();
    // cause homedir comparison to fail
    mocks.statSync.mockImplementationOnce(() => /** @type {*} */ ({ ino: 2 }));

    expect(normalizedTmpdir()).toBe(paths.shortTemp);
    expect(mocks.spawnSync).toHaveBeenCalled(); // verify it went to failure path
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('on failure, logs to default console if console: true', () => {
    const logSpy = jest.spyOn(console, 'warn').mockImplementation(noOp);
    const mocks = windowsMocks();
    mocks.statSync.mockImplementationOnce(() => /** @type {*} */ ({ ino: 2 }));

    expect(normalizedTmpdir({ console: true })).toBe(paths.shortTemp);
    expect(mocks.spawnSync).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('on failure, logs to provided console', () => {
    const mockLog = jest.fn();
    const mocks = windowsMocks();
    mocks.statSync.mockImplementationOnce(() => /** @type {*} */ ({ ino: 2 }));

    expect(normalizedTmpdir({ console: { warn: mockLog } })).toBe(paths.shortTemp);
    expect(mocks.spawnSync).toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalled();
  });
});
