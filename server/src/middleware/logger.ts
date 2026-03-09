import path from "node:path";
import fs from "node:fs";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { readConfigFile } from "../config-file.js";
import { resolveDefaultLogsDir, resolveHomeAwarePath } from "../home-paths.js";

function resolveServerLogDir(): string {
  const envOverride = process.env.PAPERCLIP_LOG_DIR?.trim();
  if (envOverride) return resolveHomeAwarePath(envOverride);

  const fileLogDir = readConfigFile()?.logging.logDir?.trim();
  if (fileLogDir) return resolveHomeAwarePath(fileLogDir);

  return resolveDefaultLogsDir();
}

const logDir = resolveServerLogDir();
let logDirWritable = false;
try {
  fs.mkdirSync(logDir, { recursive: true });
  logDirWritable = true;
} catch {
  console.warn(`[logger] Cannot create log directory ${logDir}, falling back to stdout-only logging`);
}

const logFile = path.join(logDir, "server.log");

const sharedOpts = {
  translateTime: "HH:MM:ss",
  ignore: "pid,hostname",
};

const stdoutTarget = {
  target: "pino-pretty",
  options: { ...sharedOpts, ignore: "pid,hostname,req,res,responseTime", colorize: true, destination: 1 },
  level: "info" as const,
};

const fileTarget = {
  target: "pino-pretty",
  options: { ...sharedOpts, colorize: false, destination: logFile, mkdir: true },
  level: "debug" as const,
};

export const logger = pino({
  level: "debug",
}, pino.transport({
  targets: logDirWritable ? [stdoutTarget, fileTarget] : [stdoutTarget],
}));

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customProps() {
    return {};
  },
});
