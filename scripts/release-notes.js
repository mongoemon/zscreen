'use strict';

// Prints the GitHub release notes for a version from the changelog in version.js.
// Usage: node scripts/release-notes.js [version]   (default: the current version)
const { CHANGELOG, VERSION } = require('../version.js');

const version = process.argv[2] || VERSION;
const release = CHANGELOG.find((r) => r.version === version);
if (!release) {
  console.error(`version ${version} is not in the changelog`);
  process.exit(1);
}

const list = (lines) => lines.map((line) => `- ${line}`).join('\n');
const sections = [`## What's new\n\n${list(release.changes.en)}`];
if (release.changes.th) sections.push(`## มีอะไรใหม่\n\n${list(release.changes.th)}`);
sections.push('Web app: https://zscreen.pages.dev');
console.log(sections.join('\n\n'));
