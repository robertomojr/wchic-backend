export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.log(`[info] ${msg}`, meta);
      return;
    }
    console.log(`[info] ${msg}`);
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.warn(`[warn] ${msg}`, meta);
      return;
    }
    console.warn(`[warn] ${msg}`);
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.error(`[error] ${msg}`, meta);
      return;
    }
    console.error(`[error] ${msg}`);
  }
};
