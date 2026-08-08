type Level = 'info' | 'warn' | 'error';

function log(level: Level, jobId: string | undefined, message: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    jobId: jobId ?? null,
    message,
    ...extra,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function createLogger(jobId?: string) {
  return {
    info: (message: string, extra?: Record<string, unknown>) => log('info', jobId, message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => log('warn', jobId, message, extra),
    error: (message: string, extra?: Record<string, unknown>) => log('error', jobId, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
