import { intro, log, note, outro, spinner } from '@clack/prompts';
import type { NativeEvent } from './types.js';

type Spinner = ReturnType<typeof spinner>;

let activeSpinner: Spinner | null = null;

export function printIntro(title: string) {
  intro(title);
}

export function printOutro(message: string) {
  outro(message);
}

export function printNote(title: string, lines: Array<string | false | null | undefined>) {
  const body = lines.filter(Boolean).join('\n');
  if (body) note(body, title);
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
