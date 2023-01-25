const { describe, it, jest, afterEach, expect } = require('@jest/globals');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
  network: '\\\\server\\share',
};
const noOp = (/** @type {*} */ val) => val;
const throwError = () => {
  throw new Error('Unexpected call');
};

const attribResult = (/** @type {string} */ str) =>
  /** @type {*} */ ({ stdout: ' '.repeat(19) + str + '\r\n' });

function windowsMocks() {
  jest.spyOn(path, 'dirname').mockImplementation(path.win32.dirname);
  jest.spyOn(path, 'basename').mockImplementation(path.win32.basename);

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
}

describe('expandShortPath', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns false for unsupported paths', () => {
    throwMocks();
    expect(expandShortPath('')).toBe(false);
    expect(expandShortPath('/foo/bar')).toBe(false);
    expect(expandShortPath('\\\\foo\\bar')).toBe(false);
  });

  it('does no extra calculations for long paths', () => {
    throwMocks();
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
