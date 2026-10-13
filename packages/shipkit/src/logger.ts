import type { NativeEvent, } from './types.js';

const colors = {
  dim: '\u001B[2m',
  reset: '\u001B[0m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  cyan: '\u001B[36m',
};

function color(text: string, code: string,) {
  if (process.env.NO_COLOR) return text;
  return `${code}${text}${colors.reset}`;
}

const labels: Record<NativeEvent['level'], string> = {
  debug: color('debug', colors.dim,),
  error: color('error', colors.red,),
  info: color('info', colors.cyan,),
  success: color('done', colors.green,),
  warn: color('warn', colors.yellow,),
};

export function printEvent(input: NativeEvent | string,) {
  const event = typeof input === 'string' ? (JSON.parse(input,) as NativeEvent) : input;
  const label = labels[event.level] ?? labels.info;
  console.log(`${label} ${event.message}`,);

  if (event.data && process.env.SHIPKIT_DEBUG) {
    console.log(color(JSON.stringify(event.data, null, 2,), colors.dim,),);
  }
}

export function printHeader(title: string,) {
  console.log(color(`\n${title}`, colors.green,),);
}
