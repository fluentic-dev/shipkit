import { log, outro, spinner } from '@clack/prompts';
import { styleText } from 'node:util';
import type { NativeEvent } from './types.js';

type Spinner = ReturnType<typeof spinner>;
type PanelRow = {
  label: string;
  value: string | number | boolean | null | undefined;
};

let activeSpinner: Spinner | null = null;
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

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

function visibleWidth(value: string) {
  return stripAnsi(value).length;
}

function padVisible(value: string, width: number) {
  return `${value}${' '.repeat(Math.max(width - visibleWidth(value), 0))}`;
}

function stripAnsi(value: string) {
  return value.replace(ansiPattern, '');
}
