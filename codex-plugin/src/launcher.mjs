#!/usr/bin/env node
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
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
  const args = { project: '', session: '', localResume: false };
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
    }
  }
  return args;
}

function promptBlock({ project, session, checkpoint }) {
  if (checkpoint) {
    const metadata = parseMetadata(checkpoint) || {};
    return [
      `Restore the following shared mem9 checkpoint for project ${project}.`,
      'Reconstruct the working context first, then continue with the user\'s next request.',
      '',
      metadata.checkpoint_content || checkpoint.content,
    ].join('\n');
  }

  return [
    'This Codex session uses mem9 shared memory.',
    `project: ${project}`,
    `session: ${session || 'unspecified'}`,
    'At session start, recall any relevant mem9 context before making major decisions.',
    'Before compaction, handoff, or pause, save a checkpoint with mem9_checkpoint_save.',
  ].join('\n');
}

function launchCodex({ codexArgs, prompt, project, session, mode }) {
  const env = {
    ...process.env,
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

  if (args.localResume) {
    launchCodex({ codexArgs, project, session, mode: 'local-resume' });
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
      launchCodex({
        codexArgs,
        project,
        session: resumedSession,
        prompt: promptBlock({ project, session: resumedSession, checkpoint }),
        mode: 'new',
      });
      return;
    }

    const nameAnswer = await rl.question(`Session name${session ? ` [${session}]` : ''}: `);
    const finalSession = nameAnswer.trim() || session || `${project}-session`;
    const extraPrompt = await rl.question('Optional initial prompt: ');
    rl.close();
    const prompt = [promptBlock({ project, session: finalSession }), extraPrompt.trim()].filter(Boolean).join('\n\n');
    launchCodex({ codexArgs, project, session: finalSession, prompt, mode: 'new' });
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`launcher error: ${error.message}`);
  process.exit(1);
});
