import { log, outro, spinner } from '@clack/prompts';
import { styleText } from 'node:util';
import wrapAnsi from 'wrap-ansi';
import type { NativeEvent, NativeProcessLog } from './types.js';

type Spinner = ReturnType<typeof spinner>;
export type NativeLogMode = 'auto' | 'collapsed' | 'expanded';
type PanelRow = {
  label: string;
  value: string | number | boolean | null | undefined;
};
type DetailSection = {
  title: string;
  rows: PanelRow[];
};
type TableColumn = {
  key: string;
  label: string;
  maxWidth?: number;
  style?: (value: string) => string;
};
type TableRow = Record<string, string | number | boolean | null | undefined>;
type NativeLogLine = {
  prefix: string;
  text: string;
};

let activeSpinner: Spinner | null = null;
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
const clearDown = `${String.fromCharCode(27)}[0J`;
const nativeLogRows = 20;
const nativeLogTail = nativeLogRows - 1;
const nativeSpinnerFrames = ['◐', '◓', '◑', '◒'] as const;

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
  const contentWidth = Math.max(28, labelWidth + valueWidth + 2, visibleWidth(title) + 2);
  const topTail = '─'.repeat(Math.max(contentWidth - visibleWidth(title), 1));
  const horizontal = '─'.repeat(contentWidth + 2);

  const lines = [
    `${styleText('green', '╭')} ${styleText(['bold', 'green'], title)} ${
      styleText('green', `${topTail}╮`)
    }`,
    ...visibleRows.map((row) => {
      const label = padVisible(row.label, labelWidth);
      const value = padVisible(row.value, valueWidth);
      const content = `${styleText('dim', label)}  ${styleText('bold', value)}`;
      const padding = ' '.repeat(Math.max(contentWidth - visibleWidth(content), 0));
      return `${styleText('green', '│')} ${content}${padding} ${styleText('green', '│')}`;
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

export function printGuide(title: string, lines: string[]) {
  const visibleLines = lines.filter((line) => line.trim().length > 0);
  if (visibleLines.length === 0) return;

  const width = Math.max(1, Math.min(84, (process.stdout.columns || 88) - 4));
  const rail = styleText('dim', '│');
  const output = [rail];
  if (title) {
    output.push(`${styleText('cyan', '◇')}  ${styleText('bold', title)}`, rail);
  }
  for (const line of visibleLines) {
    for (const wrapped of wrapAnsi(line.replace(/^- /u, ''), width, { hard: true }).split('\n')) {
      output.push(`${rail}  ${wrapped}`);
    }
  }
  output.push(rail);
  process.stdout.write(`${output.join('\n')}\n`);
}

export function printDetailPanel(title: string, sections: DetailSection[]) {
  const visibleSections = sections
    .map((section) => ({
      title: section.title,
      rows: section.rows
        .filter((row) => row.value !== undefined && row.value !== null && row.value !== '')
        .map((row) => ({
          label: row.label,
          value: String(row.value)
        }))
    }))
    .filter((section) => section.rows.length > 0);

  if (visibleSections.length === 0) return;

  const labelWidth = Math.max(
    ...visibleSections.flatMap((section) => section.rows.map((row) => visibleWidth(row.label))),
    1
  );
  const contentWidth = Math.max(
    36,
    visibleWidth(title) + 2,
    ...visibleSections.flatMap((section) => [
      visibleWidth(section.title) + 2,
      ...section.rows.map((row) => labelWidth + visibleWidth(row.value) + 2)
    ])
  );
  const topTail = '─'.repeat(Math.max(contentWidth - visibleWidth(title), 1));
  const horizontal = '─'.repeat(contentWidth + 2);
  const lines = [
    `${styleText('green', '╭')} ${styleText(['bold', 'green'], title)} ${
      styleText('green', `${topTail}╮`)
    }`
  ];

  for (const [index, section] of visibleSections.entries()) {
    if (index > 0) {
      lines.push(
        `${styleText('green', '│')} ${' '.repeat(contentWidth)} ${styleText('green', '│')}`
      );
    }

    const sectionTitle = styleText(['bold', 'cyan'], section.title);
    lines.push(
      `${styleText('green', '│')} ${sectionTitle}${
        ' '.repeat(Math.max(contentWidth - visibleWidth(sectionTitle), 0))
      } ${styleText('green', '│')}`
    );

    for (const row of section.rows) {
      const label = padVisible(row.label, labelWidth);
      const content = `${styleText('dim', label)}  ${styleText('bold', row.value)}`;
      const padding = ' '.repeat(Math.max(contentWidth - visibleWidth(content), 0));
      lines.push(`${styleText('green', '│')} ${content}${padding} ${styleText('green', '│')}`);
    }
  }

  lines.push(
    `${styleText('green', '╰')}${styleText('green', horizontal)}${styleText('green', '╯')}`
  );
  process.stdout.write(`${lines.join('\n')}\n\n`);
}

export function printTablePanel(title: string, columns: TableColumn[], rows: TableRow[]) {
  if (columns.length === 0) return;

  const normalizedRows = rows.length > 0 ? rows : [Object.fromEntries(columns.map((column) => [
    column.key,
    column.key === columns[0]?.key ? 'none' : ''
  ]))];
  const columnWidths = columns.map((column) => {
    const maxContentWidth = Math.max(
      visibleWidth(column.label),
      ...normalizedRows.map((row) => visibleWidth(formatStyledTableCell(column, row[column.key])))
    );
    return column.maxWidth ? Math.min(maxContentWidth, column.maxWidth) : maxContentWidth;
  });
  const contentWidth = Math.max(
    28,
    visibleWidth(title) + 2,
    columnWidths.reduce((width, columnWidth) => width + columnWidth, 0)
      + Math.max(columnWidths.length - 1, 0) * 3
  );
  const topTail = '─'.repeat(Math.max(contentWidth - visibleWidth(title), 1));
  const horizontal = '─'.repeat(contentWidth + 2);
  const header = columns
    .map((column, index) =>
      padVisible(truncateText(column.label, columnWidths[index] ?? 0), columnWidths[index] ?? 0)
    )
    .join('   ');
  const lines = [
    `${styleText('green', '╭')} ${styleText(['bold', 'green'], title)} ${
      styleText('green', `${topTail}╮`)
    }`,
    `${styleText('green', '│')} ${styleText('dim', header)}${
      ' '.repeat(Math.max(contentWidth - visibleWidth(header), 0))
    } ${styleText('green', '│')}`,
    ...normalizedRows.map((row) => {
      const rawCells = columns.map((column, index) =>
        padVisible(
          formatStyledTableCell(column, row[column.key], columnWidths[index] ?? 0),
          columnWidths[index] ?? 0
        )
      );
      const content = rawCells
        .map((cell, index) =>
          columns[index]?.style ? cell : index === 0 ? styleText('bold', cell) : cell
        )
        .join('   ');
      const padding = ' '.repeat(Math.max(contentWidth - visibleWidth(content), 0));
      return `${styleText('green', '│')} ${content}${padding} ${styleText('green', '│')}`;
    }),
    `${styleText('green', '╰')}${styleText('green', horizontal)}${styleText('green', '╯')}`
  ];

  process.stdout.write(`${lines.join('\n')}\n\n`);
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
  activeSpinner = spinner({ withGuide: false });
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
  let expandedStream = options.mode === 'expanded';
  let phase = 'Preparing build';
  let keyboardCleanup: (() => void) | null = null;
  let lastRenderedFrame = '';
  let renderedLines = 0;
  let spinnerFrame = 0;

  function start() {
    if (!tty || options.mode === 'collapsed') {
      log.step(phase);
      return;
    }

    setupKeyboard();
    if (expandedStream) {
      writeExpandedHeader();
    } else {
      renderTail();
    }
  }

  function event(event: NativeEvent) {
    drainKeyboardInput();

    if (event.level === 'debug' && !process.env.SHIPKIT_DEBUG) {
      return;
    }

    if (event.message === 'progress.tick') {
      if (live && !expandedStream) scheduleRenderTail();
      return;
    }

    if (event.message === 'progress.toggle_logs') {
      toggleExpandedStream();
      return;
    }

    const nextPhase = phaseFromNativeEvent(event.message);
    if (nextPhase) {
      phase = nextPhase;
      if (!tty || options.mode === 'collapsed') {
        log.step(phase);
      } else if (expandedStream) {
        writeNativeLine({ prefix: 'stage', text: phase });
      } else if (live) {
        scheduleRenderTail();
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
    drainKeyboardInput();

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

    cancelPendingRender();
    cleanupKeyboard();

    if (!success) {
      renderFailureLogs();
      log.error(`${options.title} failed`);
      return;
    }

    if (expandedStream) {
      phase = 'Build complete';
    } else {
      clearRendered();
    }

    log.success(`${options.title} complete`);
  }

  function push(line: NativeLogLine) {
    lines.push(line);

    if (!tty) {
      process.stdout.write(`${styleText('dim', '│')} ${formatNativeLogLine(line)}\n`);
      return;
    }

    if (!live) return;

    if (expandedStream) {
      writeNativeLine(line);
    } else {
      scheduleRenderTail();
    }
  }

  function scheduleRenderTail() {
    renderTail();
  }

  function cancelPendingRender() {
    // Rendering is synchronous inside native callbacks so logs update during the Rust call.
  }

  function renderTail() {
    const visible = lines.slice(-nativeLogTail);
    render(visible, { status: phase });
  }

  function renderFailureLogs() {
    if (lines.length === 0) {
      return;
    }

    if (expandedStream) {
      process.stdout.write(
        `\n${styleText('dim', '│')} ${styleText('dim', '[shipkit]')} Build failed.\n`
      );
      return;
    }

    render(lines, { status: 'Build failed', final: true });
  }

  function render(nextLines: NativeLogLine[], options: { final?: boolean; status: string; }) {
    const frame = formatNativeLogTail(nextLines, options.status, {
      final: options.final ?? false,
      spinnerFrame: spinnerFrame
    });
    spinnerFrame = (spinnerFrame + 1) % nativeSpinnerFrames.length;

    if (frame === lastRenderedFrame) return;

    clearRendered();
    process.stdout.write(frame);
    lastRenderedFrame = frame;
    renderedLines = countRenderedRows(frame);
  }

  function clearRendered() {
    cancelPendingRender();
    if (renderedLines === 0) return;
    process.stdout.write(`${String.fromCharCode(27)}[${renderedLines}A${clearDown}`);
    lastRenderedFrame = '';
    renderedLines = 0;
  }

  function setupKeyboard() {
    if (!live || keyboardCleanup || !process.stdin.isTTY) return;

    const input = process.stdin;
    const wasRaw = input.isRaw;
    const wasPaused = input.isPaused();

    input.setRawMode(true);
    input.resume();
    keyboardCleanup = () => {
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      keyboardCleanup = null;
    };
  }

  function drainKeyboardInput() {
    if (!keyboardCleanup) return;

    let chunk: Buffer | string | null;
    while ((chunk = process.stdin.read() as Buffer | string | null) !== null) {
      handleKeyboardData(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
    }
  }

  function handleKeyboardData(text: string) {
    if (text.includes('\u0003')) {
      cleanupKeyboard();
      process.kill(process.pid, 'SIGINT');
      return;
    }

    const toggles = text.match(/[lL]/g)?.length ?? 0;
    for (let index = 0; index < toggles; index += 1) {
      toggleExpandedStream();
    }
  }

  function cleanupKeyboard() {
    keyboardCleanup?.();
  }

  function toggleExpandedStream() {
    if (!live) return;

    if (expandedStream) {
      expandedStream = false;
      process.stdout.write('\n');
      renderTail();
      return;
    }

    clearRendered();
    expandedStream = true;
    writeExpandedHeader();
    for (const line of lines.slice(-nativeLogTail)) {
      writeNativeLine(line);
    }
  }

  function writeExpandedHeader() {
    process.stdout.write(
      `${styleText('dim', '│')} ${
        styleText('dim', '[shipkit]')
      } Native logs expanded. Press l to return to tail.\n`
    );
  }

  function writeNativeLine(line: NativeLogLine) {
    process.stdout.write(`${styleText('dim', '│')} ${formatNativeLogLine(line)}\n`);
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
    'expo.run_android': 'Running Expo Android',
    'expo.run_ios': 'Running Expo iOS',
    'expo.prebuild': 'Running Expo prebuild',
    'gradle.build': 'Running Gradle',
    'ios.prepare_keychain': 'Preparing iOS keychain',
    'ios.install_profiles': 'Installing provisioning profiles',
    'prebuild.adopt': 'Updating existing native project',
    'prebuild.ready': 'Prebuild ready',
    'prebuild.restore': 'Restoring cached prebuild',
    'prebuild.save': 'Saving current prebuild',
    'prebuild.skip': 'Using existing prebuild',
    'switch.ready': 'Switch ready',
    'security.create_keychain': 'Creating iOS keychain',
    'security.delete_keychain': 'Cleaning iOS keychain',
    'security.import_certificate': 'Importing signing certificate',
    'security.set_key_partition_list': 'Configuring keychain access',
    'security.set_keychain_settings': 'Configuring iOS keychain',
    'security.unlock_keychain': 'Unlocking iOS keychain',
    'xcode.signing': 'Configuring Xcode signing',
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

function formatTableCell(value: string | number | boolean | null | undefined) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function formatStyledTableCell(
  column: TableColumn,
  value: string | number | boolean | null | undefined,
  width?: number
) {
  const raw = formatTableCell(value);
  const limit = width === undefined
    ? undefined
    : Math.max(width - styleWidthOffset(column, raw), 1);
  const text = limit === undefined ? raw : truncateText(raw, limit);
  return column.style?.(text) ?? text;
}

function styleWidthOffset(column: TableColumn, value: string) {
  return column.style ? visibleWidth(column.style(value)) - visibleWidth(value) : 0;
}

function stripAnsi(value: string) {
  return value.replace(ansiPattern, '');
}

function formatNativeLogTail(
  lines: NativeLogLine[],
  status: string,
  options: { final?: boolean; spinnerFrame: number; }
) {
  const width = nativeLogContentWidth();
  const displayLines = options.final ? lines : lines.slice(-nativeLogTail);
  const logLines = displayLines.map((line) =>
    `${styleText('dim', '│')} ${formatNativeLogTailLine(line, width)}`
  );
  const spinnerText = options.final
    ? styleText('red', '■')
    : styleText('cyan', nativeSpinnerFrames[options.spinnerFrame] ?? nativeSpinnerFrames[0]);
  const statusLine = `${styleText('dim', '│')} ${spinnerText} ${
    styleText('dim', truncateVisible(status, width - 2))
  }`;

  return `${[statusLine, ...logLines].join('\n')}\n`;
}

function nativeLogContentWidth() {
  return Math.max((process.stdout.columns ?? 88) - 8, 24);
}

function countRenderedRows(frame: string) {
  const terminalWidth = Math.max(process.stdout.columns ?? 88, 1);
  const lines = frame.endsWith('\n') ? frame.slice(0, -1).split('\n') : frame.split('\n');

  return lines.reduce((rows, line) => {
    const width = Math.max(visibleWidth(line), 1);
    return rows + Math.max(Math.ceil(width / terminalWidth), 1);
  }, 0);
}

function formatNativeLogLine(line: NativeLogLine) {
  return `${styleText('dim', `[${formatNativeLogPrefix(line.prefix)}]`)} ${stripAnsi(line.text)}`;
}

function formatNativeLogTailLine(line: NativeLogLine, width: number) {
  const prefix = `[${formatNativeLogPrefix(line.prefix)}]`;
  const prefixText = `${styleText('dim', prefix)} `;
  const textWidth = Math.max(width - visibleWidth(prefix) - 1, 1);
  return `${prefixText}${truncateText(stripAnsi(line.text), textWidth)}`;
}

function formatNativeLogPrefix(prefix: string) {
  const label = prefix.split(':')[0] ?? prefix;
  if (label === 'expo.prebuild') return 'expo';
  if (label === 'gradle.build') return 'gradle';
  if (label.startsWith('xcodebuild.')) return 'xcode';
  if (label.startsWith('security.')) return 'security';
  return label;
}

function truncateVisible(value: string, width: number) {
  const stripped = stripAnsi(value);
  if (stripped.length <= width) return value;
  return truncateText(stripped, width);
}

function truncateText(value: string, width: number) {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(width - 1, 0))}…`;
}
