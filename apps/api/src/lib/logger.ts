import pino, { type Logger } from 'pino';

export type { Logger };

// Redaction list from TRD §14. Request bodies are never logged.
const SECRET_KEYS = ['authorization', 'cookie', 'password', 'token', 'key', 'ciphertext'];

export function createLogger(level: string, nodeEnv: string, stream?: pino.DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    redact: {
      paths: [...SECRET_KEYS, ...SECRET_KEYS.map((k) => `*.${k}`), 'req.headers.authorization', 'req.headers.cookie'],
      censor: '[redacted]',
    },
    ...(nodeEnv === 'development' && !stream ? { transport: { target: 'pino-pretty' } } : {}),
  };
  return stream ? pino(options, stream) : pino(options);
}
