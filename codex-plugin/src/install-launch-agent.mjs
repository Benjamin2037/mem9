#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function expandHome(filePath) {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function expandEnvValue(rawValue) {
  return String(rawValue || '')
    .replace(/\$\((hostname(?:\s+-s)?)\)/g, (_, command) => {
      if (command === 'hostname -s') {
        return os.hostname().split('.')[0];
      }
      return os.hostname();
    })
    .replace(/\$HOME\b/g, os.homedir());
}

async function parseEnvFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('export ')) {
      continue;
    }
    const body = trimmed.slice(7);
    const index = body.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = body.slice(0, index).trim();
    const value = expandEnvValue(body.slice(index + 1).trim().replace(/^"|"$/g, ''));
    env[key] = value;
  }
  return env;
}

async function main() {
  const envFile = expandHome(process.argv[2] || '~/.codex/mem9.env');
  const env = await parseEnvFile(envFile);
  const pluginRoot = env.MNEMO_PLUGIN_ROOT;
  if (!pluginRoot) {
    throw new Error('MNEMO_PLUGIN_ROOT is missing in ~/.codex/mem9.env');
  }

  const label = 'com.benjamin2037.codex.mem9-watcher';
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const stdoutPath = path.join(os.homedir(), '.codex', 'log', 'mem9-watcher.stdout.log');
  const stderrPath = path.join(os.homedir(), '.codex', 'log', 'mem9-watcher.stderr.log');
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);
  const nodePath = process.execPath || '/opt/homebrew/bin/node';

  await fs.mkdir(launchAgentsDir, { recursive: true });
  await fs.mkdir(path.dirname(stdoutPath), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${pluginRoot}/src/history-watcher.mjs</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${pluginRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MNEMO_API_URL</key>
    <string>${env.MNEMO_API_URL || ''}</string>
    <key>MNEMO_TENANT_ID</key>
    <string>${env.MNEMO_TENANT_ID || ''}</string>
    <key>MNEMO_AGENT_ID</key>
    <string>${env.MNEMO_AGENT_ID || `codex-${os.hostname().split('.')[0]}`}</string>
    <key>MNEMO_PLUGIN_ROOT</key>
    <string>${pluginRoot}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>
</dict>
</plist>
`;

  await fs.writeFile(plistPath, plist, 'utf8');
  console.log(plistPath);
}

main().catch((error) => {
  console.error(`install-launch-agent error: ${error.message}`);
  process.exit(1);
});
