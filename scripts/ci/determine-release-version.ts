import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

interface PackageJson {
  name: string;
  version: string;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;
const outputPath = process.env.GITHUB_OUTPUT;

const currentVersion = pkg.version;
const releaseTag = execFileSync('git', ['tag', '--points-at', 'HEAD', '--list', 'v*'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean)[0];

function parse(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported semver: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function bumpPatch(version: string): string {
  const [major, minor, patch] = parse(version);
  return `${major}.${minor}.${patch + 1}`;
}

let version: string;
let existingTag = 'false';
let publishedVersion = '';

if (releaseTag) {
  version = releaseTag.replace(/^v/, '');
  parse(version);
  existingTag = 'true';
} else {
  try {
    publishedVersion = execFileSync('npm', ['view', pkg.name, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_error) {
    publishedVersion = '';
  }

  const baseVersion =
    publishedVersion && compare(publishedVersion, currentVersion) > 0
      ? publishedVersion
      : currentVersion;
  version = bumpPatch(baseVersion);
}

execFileSync('npm', ['version', version, '--no-git-tag-version'], { stdio: 'inherit' });

const lines = [
  `package_name=${pkg.name}`,
  `version=${version}`,
  `tag=v${version}`,
  `existing_tag=${existingTag}`,
  `published_version=${publishedVersion}`,
  `release_commit=${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}`,
];

const output = `${lines.join('\n')}\n`;
if (outputPath) {
  appendFileSync(outputPath, output);
} else {
  process.stdout.write(output);
}
