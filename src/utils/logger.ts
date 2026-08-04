import { NAME } from "../constants.ts";
import { isProd } from "./environment.ts";

export enum LogLevel {
  TRACE = 10,
  DEBUG = 20,
  INFO = 30,
  WARN = 40,
  ERROR = 50,
  FATAL = 60,
}

const ENV_VAR = "HUUMA_LOG_LEVEL";

const LEVEL_BY_NAME: Record<string, LogLevel> = {
  TRACE: LogLevel.TRACE,
  DEBUG: LogLevel.DEBUG,
  INFO: LogLevel.INFO,
  WARN: LogLevel.WARN,
  ERROR: LogLevel.ERROR,
  FATAL: LogLevel.FATAL,
};

// Verbose by default so local development shows everything; in production the
// output is limited to INFO and above unless the log level is set explicitly.
function resolveDefault(): LogLevel {
  return isProd() ? LogLevel.INFO : LogLevel.DEBUG;
}

function parseLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined;
  return LEVEL_BY_NAME[value.toUpperCase()];
}

function resolveInitialLevel(): LogLevel {
  try {
    return parseLevel(Deno.env.get(ENV_VAR)) ?? resolveDefault();
  } catch (error) {
    if (
      error instanceof Deno.errors.NotCapable ||
      (error instanceof Error && error.name === "PermissionDenied")
    ) {
      return LogLevel.DEBUG;
    }
    throw error;
  }
}

let currentLevel: LogLevel = resolveInitialLevel();

/** Overrides the active log level at runtime. Takes precedence over `HUUMA_LOG_LEVEL`. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldEmit(level: LogLevel): boolean {
  return level >= currentLevel;
}

function emit(
  level: LogLevel,
  context: string,
  message: string,
  name = NAME,
): void {
  if (!shouldEmit(level)) return;

  const sink = level >= LogLevel.ERROR
    ? console.error
    : level >= LogLevel.WARN
    ? console.warn
    : level >= LogLevel.INFO
    ? console.info
    : console.log;

  sink(
    `${bold(date(new Date()))} ${bold(colorize(name, level))} ${
      bold(context)
    } ${message}`,
  );
}

export function trace(context: string, message: string, name?: string) {
  emit(LogLevel.TRACE, context, message, name);
}

export function debug(context: string, message: string, name?: string) {
  emit(LogLevel.DEBUG, context, message, name);
}

export function info(context: string, message: string, name?: string) {
  emit(LogLevel.INFO, context, message, name);
}

export function warn(context: string, message: string, name?: string) {
  emit(LogLevel.WARN, context, message, name);
}

export function error(context: string, message: string, name?: string) {
  emit(LogLevel.ERROR, context, message, name);
}

export function fatal(context: string, message: string, name?: string) {
  emit(LogLevel.FATAL, context, message, name);
}

// Backward-compatible alias. Existing `log(...)` callers keep working and are
// treated as DEBUG output, which respects the configured log level.
export const log = debug;

function colorize(text: string, level: LogLevel): string {
  switch (level) {
    case LogLevel.TRACE:
    case LogLevel.DEBUG:
      return gray(text);
    case LogLevel.INFO:
      return green(text);
    case LogLevel.WARN:
      return yellow(text);
    case LogLevel.ERROR:
    case LogLevel.FATAL:
      return red(text);
    default:
      return text;
  }
}

function gray(text: string) {
  return `\x1b[90m${text}\x1b[0m`;
}

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`;
}

function yellow(text: string) {
  return `\x1b[33m${text}\x1b[0m`;
}

function green(text: string) {
  return `\x1b[32m${text}\x1b[0m`;
}

function bold(text: string) {
  return `\x1b[1m${text}\x1b[0m`;
}

function date(date: Date): string {
  return `${doubleDigits(date.getDate())}.${
    doubleDigits(date.getMonth() + 1)
  }.${doubleDigits(date.getFullYear())} ${time(date)}`;
}

function time(date: Date): string {
  return `${doubleDigits(date.getHours())}:${doubleDigits(date.getMinutes())}:${
    doubleDigits(date.getSeconds())
  }`;
}

function doubleDigits(number: number): string {
  const str = number.toString();
  if (str.length === 1) {
    return `0${str}`;
  }
  return str;
}
