#!/usr/bin/env node
// claude-code-statusline setup command
// Run: /claude-code-statusline:setup inside Claude Code

import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude');
const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.local.json');
const SCRIPT_TARGET = join(CLAUDE_DIR, 'statusline.js');
const SUBAGENT_SCRIPT_TARGET = join(CLAUDE_DIR, 'subagent-statusline.js');

function log(msg: string) {
  console.log(`\x1b[36m▶ claude-code-statusline\x1b[0m ${msg}`);
}

function success(msg: string) {
  console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
}

function warn(msg: string) {
  console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

// ---- determine script source ----
// In a plugin install, __dirname is /commands/; script is one level up
const scriptSource = join(dirname(new URL(import.meta.url).pathname), '..', 'statusline.js');
const subagentScriptSource = join(dirname(new URL(import.meta.url).pathname), '..', 'subagent-statusline.js');
if (!existsSync(scriptSource)) {
  // Fallback: maybe running from repo root
  const fallback = join(process.cwd(), 'statusline.js');
  scriptSource = existsSync(fallback) ? fallback : '';
  const subFallback = join(process.cwd(), 'subagent-statusline.js');
  subagentScriptSource = existsSync(subFallback) ? subFallback : '';
}
if (!scriptSource) {
  warn('statusline.js not found next to the setup command.');
  log('Please ensure statusline.js is in the same directory as commands/.');
  process.exit(1);
}

// ---- ensure ~/.claude exists ----
if (!existsSync(CLAUDE_DIR)) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
}

// ---- copy statusline.js ----
copyFileSync(scriptSource, SCRIPT_TARGET);
success(`statusline.js installed to ${SCRIPT_TARGET}`);

// ---- read / init settings.local.json ----
let config: Record<string, unknown> = {};
if (existsSync(SETTINGS_FILE)) {
  try {
    config = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    if (config.statusLine) {
      warn('statusLine already exists in settings.local.json, updating...');
    }
  } catch (e) {
    warn(`settings.local.json was invalid JSON, will recreate.`);
    config = {};
  }
}

// ---- determine node.exe path (Windows compat) ----
// Use the same node that's running this script
const nodePath = process.execPath.replace(/\\/g, '/');
const scriptPath = SCRIPT_TARGET.replace(/\\/g, '/');

let command: string;
if (process.platform === 'win32') {
  // Windows: use the full path with proper escaping
  command = `"${nodePath}" "${scriptPath}"`;
} else {
  // macOS / Linux
  command = `node "${scriptPath}"`;
}

// ---- write statusLine config ----
config.statusLine = {
  type: 'command',
  command: command,
  refreshInterval: 3,
  hideVimModeIndicator: true,
};

writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
success(`statusLine added to ${SETTINGS_FILE}`);

// ---- subagent-statusline ----
if (subagentScriptSource && existsSync(subagentScriptSource)) {
  copyFileSync(subagentScriptSource, SUBAGENT_SCRIPT_TARGET);
  success(`subagent-statusline.js installed to ${SUBAGENT_SCRIPT_TARGET}`);
  config.subagentStatusLine = {
    type: 'command',
    command: command.replace('statusline.js', 'subagent-statusline.js'),
  };
  writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
  success(`subagentStatusLine added to ${SETTINGS_FILE}`);
} else {
  log('subagent-statusline.js not found, skipping agent panel customization.');
}

// ---- done ----
console.log('');
log('✨ Setup complete!');
log('Restart Claude Code to see the statusline.');
console.log('');
log('The statusline shows:');
log('  Line 1: git branch . repo link . project dir . model(badge+tier) . clock');
log('  Line 2: ⦗Pac-Man bar⦘ . tokens . cost . turns . code churn');
if (subagentScriptSource && existsSync(subagentScriptSource)) {
  log('  Agent panel: agent rows with type badge, status, time, tokens');
}
console.log('');
log('Features: rainbow model animation, Pac-Man context bar, braille quota bars');
log('  DeepSeek ¥ balance/cost, opencode go usage, git, PR, vim mode');
console.log('');
log('Tip: Set your DeepSeek API key in settings.json env.ANTHROPIC_AUTH_TOKEN');
log('  or export DEEP_SEEK_API_KEY_FOR_BALANCE in your shell profile.');
console.log('');
