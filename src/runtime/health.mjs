import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MINIMUM_FREE_BYTES = 1024 ** 3;
export const MINIMUM_NODE_MAJOR = 20;

function firstLine(value) {
  return value.trim().split(/\r?\n/, 1)[0] ?? '';
}

export function parseNodeMajor(version) {
  const match = /^v?(\d+)/.exec(version);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

async function checkCommand(name, command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 10_000,
      windowsHide: true,
    });

    return { name, ok: true, detail: firstLine(stdout || stderr) };
  } catch (error) {
    return { name, ok: false, detail: firstLine(error.stderr || error.message) };
  }
}

async function checkModule(name, specifier) {
  try {
    await import(specifier);
    return { name, ok: true, detail: 'available' };
  } catch (error) {
    return { name, ok: false, detail: firstLine(error.message) };
  }
}

export function evaluateHealth({ nodeVersion, commands, freeBytes }) {
  const nodeMajor = parseNodeMajor(nodeVersion);
  const checks = [
    {
      name: 'Node.js',
      ok: Number.isFinite(nodeMajor) && nodeMajor >= MINIMUM_NODE_MAJOR,
      detail: nodeVersion,
    },
    ...commands,
    {
      name: 'free disk space',
      ok: freeBytes >= MINIMUM_FREE_BYTES,
      detail: `${(freeBytes / 1024 ** 3).toFixed(2)} GiB available`,
    },
  ];

  return { ok: checks.every((check) => check.ok), checks };
}

export async function getHealthReport(projectRoot = process.cwd()) {
  const commandChecks = process.platform === 'win32'
    ? await Promise.all([
      checkCommand('npm', 'cmd.exe', ['/d', '/s', '/c', 'npm --version']),
      checkCommand('Git', 'git.exe', ['--version']),
      checkCommand('FFmpeg', 'ffmpeg.exe', ['-version']),
      checkCommand('FFprobe', 'ffprobe.exe', ['-version']),
    ])
    : await Promise.all([
      checkCommand('npm', 'npm', ['--version']),
      checkCommand('Git', 'git', ['--version']),
      checkCommand('FFmpeg', 'ffmpeg', ['-version']),
      checkCommand('FFprobe', 'ffprobe', ['-version']),
    ]);
  const moduleCheck = await checkModule('Resvg', '@resvg/resvg-js');
  const filesystem = await statfs(path.resolve(projectRoot));
  const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);

  return evaluateHealth({
    nodeVersion: process.version,
    commands: [...commandChecks, moduleCheck],
    freeBytes,
  });
}
