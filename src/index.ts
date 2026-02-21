import * as p from '@clack/prompts';
import boxen from 'boxen';
import { showBanner } from './ui/banner.js';
import { frappe, theme, boxColors } from './ui/theme.js';
import { getConfig, setConfig, deleteConfig } from './lib/config.js';
import type { Provider, ViconConfig } from './lib/config.js';
import { detectContext } from './lib/tools.js';
import { buildSystemPrompt, buildUserPrompt } from './lib/prompt.js';
import { generate, ValidationError } from './lib/ai.js';
import { copyToClipboard } from './lib/clipboard.js';
import { runCommands } from './lib/run.js';

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function popFlag(flags: string[]): string | undefined {
  for (const flag of flags) {
    const i = args.indexOf(flag);
    if (i !== -1) {
      args.splice(i, 1);
      return flag;
    }
  }
  return undefined;
}

function popFlagValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i !== -1 && i + 1 < args.length) {
    const val = args[i + 1];
    args.splice(i, 2);
    return val;
  }
  return undefined;
}

const helpFlag = popFlag(['--help', '-h']);
const versionFlag = popFlag(['--version', '-v']);
const providerOverride = popFlagValue('--provider') as Provider | undefined;

// ── Help & Version ────────────────────────────────────────────────────────────

if (versionFlag) {
  const pkg = await import('../package.json') as { version: string };
  console.log(`vicon v${pkg.version}`);
  process.exit(0);
}

if (helpFlag) {
  await showBanner();
  console.log([
    '',
    `  ${theme.heading('Usage:')} vicon <request> [--provider cloudflare|claude]`,
    '',
    `  ${theme.heading('Subcommands:')}`,
    `    ${frappe.sky('setup')}      Configure AI provider credentials`,
    `    ${frappe.sky('teardown')}   Remove saved credentials`,
    '',
    `  ${theme.heading('Flags:')}`,
    `    ${frappe.sky('--provider')}  Override provider for this invocation`,
    `    ${frappe.sky('--help')}      Show this help`,
    `    ${frappe.sky('--version')}   Print version`,
    '',
    `  ${theme.heading('Examples:')}`,
    `    vicon "convert video.mp4 to gif at 15fps"`,
    `    vicon "resize all jpgs in this folder to 800px wide"`,
    `    vicon "extract audio from interview.mov as flac" --provider claude`,
    '',
  ].join('\n'));
  process.exit(0);
}

// ── Subcommands ───────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  await showBanner();
  p.intro('Configure vicon AI provider');

  const provider = await p.select<Provider>({
    message: 'Which AI provider?',
    options: [
      { value: 'cloudflare' as Provider, label: 'Cloudflare AI', hint: 'requires Account ID + API token' },
      { value: 'claude' as Provider, label: 'Claude Code CLI', hint: 'requires claude CLI installed' },
    ],
  });

  if (p.isCancel(provider)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if ((provider as Provider) === 'cloudflare') {
    const accountId = await p.text({
      message: 'Cloudflare Account ID:',
      validate: (v) => (v?.trim() ? undefined : 'Required'),
    });
    if (p.isCancel(accountId)) { p.cancel('Setup cancelled.'); process.exit(0); }

    const apiToken = await p.password({
      message: 'Cloudflare AI API token:',
      validate: (v) => (v?.trim() ? undefined : 'Required'),
    });
    if (p.isCancel(apiToken)) { p.cancel('Setup cancelled.'); process.exit(0); }

    const config: ViconConfig = {
      defaultProvider: 'cloudflare',
      cloudflare: { accountId: (accountId as string).trim(), apiToken: (apiToken as string).trim() },
    };

    try {
      await setConfig(config);
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    p.outro('Cloudflare AI configured and saved.');
  } else {
    // claude — verify CLI is available
    const proc = Bun.spawn(['which', 'claude'], { stdout: 'pipe', stderr: 'pipe' });
    await proc.exited;
    if (proc.exitCode !== 0) {
      p.log.error('claude CLI not found. Install it from https://claude.ai/code and re-run setup.');
      process.exit(1);
    }

    const config: ViconConfig = { defaultProvider: 'claude' };
    try {
      await setConfig(config);
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    p.outro('Claude Code CLI configured and saved.');
  }
}

async function runTeardown(): Promise<void> {
  await showBanner();

  const confirm = await p.confirm({
    message: 'Delete vicon config from keychain?',
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro('Teardown cancelled.');
    process.exit(0);
  }

  await deleteConfig();
  p.outro('Config deleted.');
}

// ── Tool summary line ─────────────────────────────────────────────────────────

function renderToolSummary(ctx: Awaited<ReturnType<typeof detectContext>>): string {
  const parts: string[] = [];

  if (ctx.ffmpeg.installed) {
    const ver = ctx.ffmpeg.version ?? '?';
    const enc = ctx.ffmpeg.encoders.length;
    const dec = ctx.ffmpeg.decoders.length;
    parts.push(theme.muted(`ffmpeg ${ver} (${enc} encoders · ${dec} decoders)`));
  } else {
    parts.push(frappe.yellow('ffmpeg not found'));
  }

  if (ctx.magick.installed) {
    const ver = ctx.magick.version ?? '?';
    const fmt = ctx.magick.formats.length;
    parts.push(theme.muted(`magick ${ver} (${fmt} formats)`));
  } else {
    parts.push(frappe.yellow('magick not found'));
  }

  return parts.join(theme.muted('  ·  '));
}

// ── Display panels ────────────────────────────────────────────────────────────

function renderPanels(result: { commands: string[]; explanation: string }): void {
  // Explanation panel
  const explanationBox = boxen(result.explanation, {
    borderColor: boxColors.primary,
    borderStyle: 'round',
    padding: { top: 1, bottom: 1, left: 2, right: 2 },
    title: 'What this does',
    titleAlignment: 'center',
  });
  console.log('\n' + explanationBox);

  // Commands panel
  const numberedCmds = result.commands
    .map((cmd, i) => `${frappe.sky(`[${i + 1}]`)} ${cmd}`)
    .join('\n');

  const commandsBox = boxen(numberedCmds, {
    borderColor: boxColors.default,
    dimBorder: true,
    borderStyle: 'round',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    title: 'Commands',
    titleAlignment: 'left',
  });
  console.log('\n' + commandsBox + '\n');
}

// ── Conversion flow ───────────────────────────────────────────────────────────

async function runConversion(request: string, config: ViconConfig): Promise<void> {
  // 1. Tool detection
  const toolSpinner = p.spinner();
  toolSpinner.start('Detecting tools…');
  const ctx = await detectContext();
  toolSpinner.stop('Tools detected.');

  // 2. Tool summary
  p.log.info(renderToolSummary(ctx));

  // 3. AI generation
  const genSpinner = p.spinner();
  genSpinner.start('Generating command…');

  let result: { commands: string[]; explanation: string };
  try {
    const systemPrompt = buildSystemPrompt(ctx);
    const userPrompt = buildUserPrompt(request);
    result = await generate(systemPrompt, userPrompt, config);
    genSpinner.stop('Done.');
  } catch (err) {
    genSpinner.stop('Failed.');
    if (err instanceof ValidationError) {
      p.log.error('Could not parse AI response:');
      console.log(err.raw);
    } else {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }

  // 4. Render panels
  renderPanels(result);

  // 5. Action menu loop (edit re-enters; other actions exit)
  let currentResult = result;

  while (true) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'run', label: 'Run all' },
        { value: 'edit', label: 'Edit' },
        { value: 'copy', label: 'Copy' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });

    if (p.isCancel(action) || action === 'cancel') {
      p.outro('Cancelled.');
      process.exit(0);
    }

    if (action === 'copy') {
      const ok = await copyToClipboard(currentResult.commands.join('\n'));
      if (ok) {
        p.log.success('Commands copied to clipboard.');
      } else {
        p.log.warn('No clipboard tool found. Install xclip, xsel, or wl-copy.');
      }
      process.exit(0);
    }

    if (action === 'edit') {
      const edited = await p.text({
        message: 'Edit commands (one per line):',
        initialValue: currentResult.commands.join('\n'),
      });
      if (p.isCancel(edited)) {
        p.outro('Cancelled.');
        process.exit(0);
      }
      const newCommands = (edited as string)
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      currentResult = { ...currentResult, commands: newCommands };
      renderPanels(currentResult);
      continue;
    }

    if (action === 'run') {
      const success = await runCommands(currentResult.commands, {
        onBefore: (cmd, i, total) => p.log.step(`▶ [${i + 1}/${total}] ${cmd}`),
        onSuccess: () => p.log.success('All commands completed successfully.'),
        onError: (cmd, exitCode) =>
          p.log.error(`Command exited with code ${exitCode}: ${cmd}`),
      });
      process.exit(success ? 0 : 1);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const subcommand = args[0];

if (subcommand === 'setup') {
  await runSetup();
} else if (subcommand === 'teardown') {
  await runTeardown();
} else {
  // First non-flag positional arg is the conversion request
  const request = args.find(a => !a.startsWith('-'));

  // Config is loaded here so --provider override can be applied
  let config = await getConfig();

  if (providerOverride) {
    if (config) {
      config = { ...config, defaultProvider: providerOverride };
    } else {
      config = { defaultProvider: providerOverride };
    }
  }

  if (!config) {
    await showBanner();
    p.log.error('No provider configured. Run: vicon setup');
    process.exit(1);
  }

  if (config.defaultProvider === 'cloudflare' && !config.cloudflare) {
    await showBanner();
    p.log.error('Cloudflare credentials missing. Run: vicon setup');
    process.exit(1);
  }

  await showBanner();

  if (!request) {
    p.log.info('Usage: vicon <request>  |  vicon --help for more');
    process.exit(0);
  }

  await runConversion(request, config);
}
