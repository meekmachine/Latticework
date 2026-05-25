import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Options {
  tag: string;
  commit: string;
  packageName: string;
  packageVersion: string;
}

interface GeneratedReleaseNotes {
  name?: string;
  body?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function readValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    fail(`${name} requires a value.`);
  }
  return value;
}

function parseArgs(args: string[]): Options {
  const options: Partial<Options> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--tag':
        options.tag = readValue(args, index, arg);
        index += 1;
        break;
      case '--commit':
        options.commit = readValue(args, index, arg);
        index += 1;
        break;
      case '--package-name':
        options.packageName = readValue(args, index, arg);
        index += 1;
        break;
      case '--package-version':
        options.packageVersion = readValue(args, index, arg);
        index += 1;
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  if (!options.tag || !options.commit || !options.packageName || !options.packageVersion) {
    fail('--tag, --commit, --package-name, and --package-version are required.');
  }

  return options as Options;
}

function ghOutput(args: string[]): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function runGh(args: string[]): void {
  execFileSync('gh', args, { stdio: 'inherit' });
}

function releaseExists(tag: string, repo: string): boolean {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' });
    return true;
  } catch (_error) {
    return false;
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const repo = process.env.GITHUB_REPOSITORY;

  if (!process.env.GH_TOKEN || !repo) {
    fail('GH_TOKEN and GITHUB_REPOSITORY must be set.');
  }

  const notesResponse = ghOutput([
    'api',
    '--method',
    'POST',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${repo}/releases/generate-notes`,
    '-f',
    `tag_name=${options.tag}`,
    '-f',
    `target_commitish=${options.commit}`,
  ]);
  const notes = JSON.parse(notesResponse) as GeneratedReleaseNotes;
  const releaseName = notes.name?.trim() || options.tag;
  const generatedBody = notes.body?.trim();

  const tempDir = mkdtempSync(join(tmpdir(), 'latticework-release-'));
  try {
    const notesFile = join(tempDir, 'notes.md');
    const body = [
      '## NPM Package',
      '',
      `Install: \`npm install ${options.packageName}@${options.packageVersion}\``,
      '',
      `Reference: [npmjs.com/package/${options.packageName}](https://www.npmjs.com/package/${options.packageName})`,
      generatedBody ? `\n${generatedBody}` : '',
    ].join('\n');
    writeFileSync(notesFile, `${body}\n`);

    if (releaseExists(options.tag, repo)) {
      runGh([
        'release',
        'edit',
        options.tag,
        '--repo',
        repo,
        '--title',
        releaseName,
        '--notes-file',
        notesFile,
        '--target',
        options.commit,
      ]);
    } else {
      runGh([
        'release',
        'create',
        options.tag,
        '--repo',
        repo,
        '--title',
        releaseName,
        '--notes-file',
        notesFile,
        '--target',
        options.commit,
      ]);
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
