import { log, outro, spinner } from '@clack/prompts';
import { styleText } from 'node:util';
import type { NativeEvent, NativeProcessLog } from './types.js';

type Spinner = ReturnType<typeof spinner>;
export type NativeLogMode = 'auto' | 'collapsed' | 'expanded';
type PanelRow = {
  label: string;
  value: string | number | boolean | null | undefined;
};
type NativeLogLine = {
  prefix: string;
  text: string;
};

let activeSpinner: Spinner | null = null;
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
const clearDown = `${String.fromCharCode(27)}[0J`;
const nativeLogTail = 8;

export function printIntro(title: string, context?: string) {
  const brand = styleText(['inverse', 'bold'], ' SHIPKIT ');
  const titleText = styleText(['bold', 'cyan'], title);
  const contextText = context ? ` ${styleText('dim', context)}` : '';
  process.stdout.write(`\n${brand} ${titleText}${contextText}\n\n`);
}

export function printOutro(message: string) {
  outro(message);
}

export function printPanel(title: string, rows: PanelRow[]) {
  const visibleRows = rows
    .filter((row) => row.value !== undefined && row.value !== null && row.value !== '')
    .map((row) => ({
      label: row.label,
      value: String(row.value)
    }));

  if (visibleRows.length === 0) return;

  const labelWidth = Math.max(...visibleRows.map((row) => visibleWidth(row.label)), 1);
  const valueWidth = Math.max(...visibleRows.map((row) => visibleWidth(row.value)), 1);
  const innerWidth = Math.max(28, labelWidth + valueWidth + 5, visibleWidth(title) + 4);
  const topTail = '─'.repeat(Math.max(innerWidth - visibleWidth(title) - 1, 1));
  const horizontal = '─'.repeat(innerWidth + 2);

  const lines = [
    `${styleText('green', '╭')} ${styleText(['bold', 'green'], title)} ${
      styleText('green', `${topTail}╮`)
    }`,
    ...visibleRows.map((row) => {
      const label = padVisible(row.label, labelWidth);
      const value = padVisible(row.value, valueWidth);
      const content = `${styleText('dim', label)}  ${styleText('bold', value)}`;
      const padding = ' '.repeat(Math.max(innerWidth - labelWidth - valueWidth - 2, 1));
      return `${styleText('green', '│')} ${content}${padding}${styleText('green', '│')}`;
    }),
    `${styleText('green', '╰')}${styleText('green', horizontal)}${styleText('green', '╯')}`
  ];

  process.stdout.write(`${lines.join('\n')}\n\n`);
}

export function printListPanel(title: string, lines: string[]) {
  printPanel(
    title,
    lines.length > 0
      ? lines.map((line, index) => ({ label: index === 0 ? ' ' : ' ', value: line }))
      : [{ label: ' ', value: 'none' }]
  );
}

export function startSpinner(message: string) {
  if (!process.stdout.isTTY) {
    log.step(message);

    return {
      message(next: string) {
        log.info(next);
      },
      error(next?: string) {
        log.error(next ?? message);
      },
      clear() {
        // Non-interactive logs cannot be redrawn, so keep the start line as useful trace output.
      },
      stop(next?: string) {
        log.success(next ?? message);
      }
    };
  }

  activeSpinner?.stop();
  activeSpinner = spinner();
  activeSpinner.start(message);

  return {
    message(next: string) {
      activeSpinner?.message(next);
    },
    error(message?: string) {
      activeSpinner?.error(message);
      activeSpinner = null;
    },
    clear() {
      activeSpinner?.clear();
      activeSpinner = null;
    },
    stop(message?: string) {
      activeSpinner?.stop(message);
      activeSpinner = null;
    }
  };
}

export function createNativeLogView(options: {
  mode: NativeLogMode;
  title: string;
}) {
  const tty = process.stdout.isTTY;
  const lines: NativeLogLine[] = [];
  const live = tty && options.mode !== 'collapsed';
  let phase = 'Preparing build';
  let renderedLines = 0;

  function start() {
    if (!tty || options.mode === 'collapsed') {
      log.step(phase);
      return;
    }

    renderTail();
  }

  function event(event: NativeEvent) {
    if (event.level === 'debug' && !process.env.SHIPKIT_DEBUG) {
      return;
    }

    const nextPhase = phaseFromNativeEvent(event.message);
    if (nextPhase) {
      phase = nextPhase;
      if (!tty || options.mode === 'collapsed') {
        log.step(phase);
      } else if (live) {
        renderTail();
      }
      return;
    }

    if (isHiddenNativeEvent(event.message)) {
      return;
    }

    push({
      prefix: event.level,
      text: formatEventMessage(event)
    });
  }

  function nativeLog(native: NativeProcessLog) {
    phase = phaseFromNativeLog(native.label) ?? phase;
    push({
      prefix: `${native.label}:${native.stream}`,
      text: native.line
    });
  }

  function finish(success: boolean) {
    if (!tty) {
      if (success) {
        log.success(`${options.title} finished`);
      } else {
        log.error(`${options.title} failed`);
      }
      return;
    }

    if (!success) {
      renderAll('Build failed');
      log.error(`${options.title} failed`);
      return;
    }

    if (options.mode === 'expanded') {
      phase = 'Build complete';
      renderAll('Build complete');
    } else {
      clearRendered();
      if (lines.length > 0) {
        log.info(`Native logs collapsed (${lines.length} lines)`);
      }
    }

    log.success(`${options.title} complete`);
  }

  function push(line: NativeLogLine) {
    lines.push(line);

    if (!tty) {
      process.stdout.write(`${styleText('dim', '│')} ${formatNativeLogLine(line)}\n`);
      return;
    }

    if (live) renderTail();
  }

  function renderTail() {
    const hidden = Math.max(lines.length - nativeLogTail, 0);
    const visible = lines.slice(-nativeLogTail);
    render(
      lines.length > 0 ? 'Native logs' : 'Build progress',
      hidden > 0
        ? [{ prefix: 'more', text: `${hidden} earlier lines hidden` }, ...visible]
        : visible
    );
  }

  function renderAll(title: string) {
    render(title, lines);
  }

  function render(title: string, nextLines: NativeLogLine[]) {
    clearRendered();

    const panelLines = formatNativeLogPanel(
      title,
      [{ prefix: 'stage', text: phase }, ...nextLines]
    );

    process.stdout.write(panelLines);
    renderedLines = panelLines.split('\n').filter(Boolean).length;
  }

  function clearRendered() {
    if (renderedLines === 0) return;
    process.stdout.write(`${String.fromCharCode(27)}[${renderedLines}A${clearDown}`);
    renderedLines = 0;
  }

  return {
    clear: clearRendered,
    event,
    finish,
    nativeLog,
    start
  };
}

export function printEvent(input: NativeEvent | string) {
  const event = typeof input === 'string' ? (JSON.parse(input) as NativeEvent) : input;

  if (event.level === 'debug' && !process.env.SHIPKIT_DEBUG) {
    return;
  }

  const message = formatEventMessage(event);

  switch (event.level) {
    case 'error':
      log.error(message);
      break;
    case 'success':
      log.success(message);
      break;
    case 'warn':
      log.warn(message);
      break;
    case 'debug':
      log.info(message);
      break;
    default:
      log.info(message);
      break;
  }
}

export function printError(error: unknown) {
  printEvent({
    level: 'error',
    message: error instanceof Error ? error.message : String(error)
  });
}

function formatEventMessage(event: NativeEvent) {
  const data = event.data && process.env.SHIPKIT_DEBUG
    ? `\n${JSON.stringify(event.data, null, 2)}`
    : '';

  return `${formatMessage(event.message)}${data}`;
}

function formatMessage(message: string) {
  if (/\s/.test(message)) return message;

  return message
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' ');
}

function isHiddenNativeEvent(message: string) {
  return message === 'License accepted.' || /^Planning .+ build for .+\.$/u.test(message);
}

function phaseFromNativeEvent(message: string) {
  const phases: Record<string, string> = {
    'android.prepare_signing': 'Preparing Android signing',
    'android.reset_release_outputs': 'Cleaning Android release outputs',
    'gradle.build': 'Running Gradle',
    'ios.prepare_keychain': 'Preparing iOS keychain',
    'ios.install_profiles': 'Installing provisioning profiles',
    'security.create_keychain': 'Creating iOS keychain',
    'security.delete_keychain': 'Cleaning iOS keychain',
    'security.import_certificate': 'Importing signing certificate',
    'security.set_key_partition_list': 'Configuring keychain access',
    'security.set_keychain_settings': 'Configuring iOS keychain',
    'security.unlock_keychain': 'Unlocking iOS keychain',
    'xcodebuild.archive': 'Archiving with Xcode',
    'xcodebuild.export_archive': 'Exporting IPA'
  };

  if (message.startsWith('output: ')) return 'Moving artifact';
  return phases[message] ?? null;
}

function phaseFromNativeLog(label: string) {
  return phaseFromNativeEvent(label);
}

function visibleWidth(value: string) {
  return stripAnsi(value).length;
}

function padVisible(value: string, width: number) {
  return `${value}${' '.repeat(Math.max(width - visibleWidth(value), 0))}`;
}

function stripAnsi(value: string) {
  return value.replace(ansiPattern, '');
}

function formatNativeLogPanel(title: string, lines: NativeLogLine[]) {
  const titleText = ` ${title} `;
  const maxLineWidth = Math.max(
    visibleWidth(titleText),
    ...lines.map((line) => visibleWidth(formatNativeLogLine(line)))
  );
  const terminalLimit = Math.max((process.stdout.columns ?? 88) - 4, 36);
  const innerWidth = Math.min(Math.max(maxLineWidth + 2, 36), terminalLimit, 100);
  const top = `${styleText('green', '╭')}${styleText('green', titleText)}${
    styleText('green', '─'.repeat(Math.max(innerWidth - visibleWidth(titleText), 1)))
  }${styleText('green', '╮')}`;
  const body = lines.map((line) => {
    const text = truncateVisible(formatNativeLogLine(line), innerWidth - 2);
    return `${styleText('green', '│')} ${text}${
      ' '.repeat(Math.max(innerWidth - visibleWidth(text) - 1, 0))
    }${styleText('green', '│')}`;
  });
  const bottom = `${styleText('green', '╰')}${styleText('green', '─'.repeat(innerWidth))}${
    styleText('green', '╯')
  }`;

  return `${[top, ...body, bottom].join('\n')}\n`;
}

function formatNativeLogLine(line: NativeLogLine) {
  return `${styleText('dim', `[${line.prefix}]`)} ${stripAnsi(line.text)}`;
}

function truncateVisible(value: string, width: number) {
  const stripped = stripAnsi(value);
  if (stripped.length <= width) return value;
  return `${stripped.slice(0, Math.max(width - 1, 0))}…`;
}
