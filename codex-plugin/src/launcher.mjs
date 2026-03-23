#!/usr/bin/env node
import readline from 'node:readline/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { MnemoClient } from './client.mjs';
import {
  inferProjectName,
  inferSessionName,
  parseMetadata,
  summarizeMemory,
} from './helpers.mjs';

function splitArgs(argv) {
  const divider = argv.indexOf('--');
  if (divider === -1) {
    return { launcherArgs: argv, codexArgs: [] };
  }
  return {
    launcherArgs: argv.slice(0, divider),
    codexArgs: argv.slice(divider + 1),
  };
}

function parseLauncherArgs(argv) {
  const args = { project: '', session: '', localResume: false, printStartup: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--project' && argv[i + 1]) {
      args.project = argv[i + 1];
      i += 1;
    } else if (token === '--session' && argv[i + 1]) {
      args.session = argv[i + 1];
      i += 1;
    } else if (token === '--local-resume') {
      args.localResume = true;
    } else if (token === '--print-startup') {
      args.printStartup = true;
    }
  }
  return args;
}

function loadBearWorkspaceBootstrap(project, session = '') {
  const root = String(process.env.BWS_ROOT || '').trim();
  if (!root) {
    return { enabled: false, env: {}, startupBlock: '' };
  }

  const scriptPath = path.join(root, 'src', 'codex-bootstrap.mjs');
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--workspace',
    project,
    ...(String(session || '').trim() ? ['--session-id', String(session).trim()] : []),
  ], {
    encoding: 'utf8',
    env: process.env,
  });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`BearWorkSpace bootstrap failed: ${message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`BearWorkSpace bootstrap returned invalid JSON: ${error.message}`);
  }

  return {
    enabled: true,
    workspace: parsed.workspace || project,
    machine: parsed.machine || null,
    env: parsed.env || {},
    startupBlock: String(parsed.startupBlock || '').trim(),
  };
}

function promptBlock({ project, session, checkpoint, startupBlocks = [] }) {
  const blocks = [];
  for (const block of startupBlocks) {
    const text = String(block || '').trim();
    if (text) {
      blocks.push(text);
    }
  }

  if (checkpoint) {
    const metadata = parseMetadata(checkpoint) || {};
    blocks.push([
      `Restore the following shared mem9 checkpoint for project ${project}.`,
      'Reconstruct the working context first, then continue with the user\'s next request.',
      '',
      metadata.checkpoint_content || checkpoint.content,
    ].join('\n'));
    return blocks.join('\n\n');
  }

  blocks.push([
    'This Codex session uses mem9 shared memory.',
    `project: ${project}`,
    `session: ${session || 'unspecified'}`,
    'At session start, recall any relevant mem9 context before making major decisions.',
    'Before compaction, handoff, or pause, save a checkpoint with mem9_checkpoint_save.',
  ].join('\n'));

  return blocks.join('\n\n');
}

function launchCodex({ codexArgs, prompt, project, session, mode, extraEnv = {} }) {
  const env = {
    ...process.env,
    ...extraEnv,
    MNEMO_PROJECT: project,
    MNEMO_SESSION: session || process.env.MNEMO_SESSION || '',
  };

  const args = mode === 'local-resume' ? ['resume', ...codexArgs] : [...codexArgs, prompt];
  const child = spawn('codex', args, {
    stdio: 'inherit',
    env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function chooseCheckpoint(client, project, rl) {
  const response = await client.listMemories({
    tags: ['agent:codex', 'kind:checkpoint', `project:${project.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`],
    limit: 10,
  });
  const memories = response?.memories || [];
  if (memories.length === 0) {
    return null;
  }

  console.log('\nShared checkpoints:');
  memories.forEach((memory, index) => {
    console.log(`${index + 1}. ${summarizeMemory(memory)}`);
  });

  const answer = await rl.question('Choose checkpoint number (blank cancels): ');
  const index = Number.parseInt(answer, 10);
  if (!Number.isInteger(index) || index < 1 || index > memories.length) {
    return null;
  }
  return memories[index - 1];
}

async function main() {
  const { launcherArgs, codexArgs } = splitArgs(process.argv.slice(2));
  const args = parseLauncherArgs(launcherArgs);
  const project = inferProjectName(args.project);
  const session = inferSessionName(args.session);
  const bearContext = loadBearWorkspaceBootstrap(project, session);

  if (args.localResume) {
    if (args.printStartup) {
      console.log(JSON.stringify({
        project,
        session: session || null,
        mode: 'local-resume',
        extraEnv: bearContext.env,
        startupBlocks: [bearContext.startupBlock].filter(Boolean),
      }, null, 2));
      return;
    }
    launchCodex({ codexArgs, project, session, mode: 'local-resume', extraEnv: bearContext.env });
    return;
  }

  if (args.printStartup) {
    const finalSession = session || `${project}-session`;
    console.log(JSON.stringify({
      project,
      session: finalSession,
      mode: 'new',
      extraEnv: bearContext.env,
      prompt: promptBlock({
        project,
        session: finalSession,
        startupBlocks: [bearContext.startupBlock],
      }),
    }, null, 2));
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const client = new MnemoClient();
  const mem9Ready = Boolean(process.env.MNEMO_TENANT_ID && process.env.MNEMO_API_URL);

  try {
    console.log(`Project: ${project}`);
    console.log('1) New named Codex session');
    console.log('2) Resume from shared mem9 checkpoint');
    console.log('3) Resume local Codex session');
    const choice = await rl.question('Choose [1/2/3]: ');

    if (choice.trim() === '3') {
      rl.close();
      launchCodex({ codexArgs, project, session, mode: 'local-resume' });
      return;
    }

    if (!mem9Ready) {
      throw new Error('Set MNEMO_API_URL and MNEMO_TENANT_ID before using the shared mem9 launcher.');
    }

    if (choice.trim() === '2') {
      const checkpoint = await chooseCheckpoint(client, project, rl);
      if (!checkpoint) {
        throw new Error('No shared checkpoint selected.');
      }
      const metadata = parseMetadata(checkpoint) || {};
      const resumedSession = metadata.session || session;
      rl.close();
      const prompt = promptBlock({
        project,
        session: resumedSession,
        checkpoint,
        startupBlocks: [bearContext.startupBlock],
      });
      if (args.printStartup) {
        console.log(JSON.stringify({
          project,
          session: resumedSession || null,
          mode: 'new',
          extraEnv: bearContext.env,
          prompt,
        }, null, 2));
        return;
      }
      launchCodex({
        codexArgs,
        project,
        session: resumedSession,
        prompt,
        mode: 'new',
        extraEnv: bearContext.env,
      });
      return;
    }

    const nameAnswer = await rl.question(`Session name${session ? ` [${session}]` : ''}: `);
    const finalSession = nameAnswer.trim() || session || `${project}-session`;
    const extraPrompt = await rl.question('Optional initial prompt: ');
    rl.close();
    const prompt = [
      promptBlock({ project, session: finalSession, startupBlocks: [bearContext.startupBlock] }),
      extraPrompt.trim(),
    ].filter(Boolean).join('\n\n');
    if (args.printStartup) {
      console.log(JSON.stringify({
        project,
        session: finalSession || null,
        mode: 'new',
        extraEnv: bearContext.env,
        prompt,
      }, null, 2));
      return;
    }
    launchCodex({ codexArgs, project, session: finalSession, prompt, mode: 'new', extraEnv: bearContext.env });
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`launcher error: ${error.message}`);
  process.exit(1);
});
