import { execFileSync } from 'node:child_process';

interface Options {
  tag: string;
  commit: string;
  remote: string;
  pushTag: boolean;
  dryRun: boolean;
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
  const options: Partial<Options> = {
    commit: 'HEAD',
    remote: 'origin',
    pushTag: false,
    dryRun: false,
  };

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
      case '--remote':
        options.remote = readValue(args, index, arg);
        index += 1;
        break;
      case '--push':
        options.pushTag = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  if (!options.tag) {
    fail('--tag is required.');
  }

  return options as Options;
}

function gitOutput(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function runGit(args: string[]): void {
  execFileSync('git', args, { stdio: 'inherit' });
}

function remoteTagCommit(remote: string, tag: string): string {
  const peeled = gitOutput(['ls-remote', '--tags', remote, `refs/tags/${tag}^{}`]);
  if (peeled) {
    return peeled.split(/\s+/)[0] ?? '';
  }

  const direct = gitOutput(['ls-remote', '--tags', remote, `refs/tags/${tag}`]);
  return direct.split(/\s+/)[0] ?? '';
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const commitSha = gitOutput(['rev-parse', options.commit]);
  const existingRemoteCommit = remoteTagCommit(options.remote, options.tag);

  if (existingRemoteCommit && existingRemoteCommit !== commitSha) {
    fail(`Tag ${options.tag} points to ${existingRemoteCommit}, expected ${commitSha}.`);
  }

  if (existingRemoteCommit) {
    return;
  }

  const tagArgs = [
    '-c',
    'user.name=github-actions[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'tag',
    '-a',
  ];

  if (options.dryRun) {
    const tempTag = `${options.tag}-dry-run`;
    runGit([...tagArgs, tempTag, '-m', `Release ${options.tag}`, commitSha]);
    runGit(['tag', '-d', tempTag]);
    return;
  }

  runGit([...tagArgs, options.tag, '-m', `Release ${options.tag}`, commitSha]);

  if (options.pushTag) {
    runGit(['push', options.remote, options.tag]);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
