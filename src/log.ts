type Context = Record<string, unknown>;

/** JSON.stringify writes an Error as {}; keep what is needed to find the cause. */
const errors = (_key: string, value: unknown): unknown =>
  value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;

const line = (level: 'info' | 'error', msg: string, ctx?: Context): string =>
  JSON.stringify({ level, msg, time: new Date().toISOString(), ...ctx }, errors);

/** One JSON object per line. Never put tokens, OAuth codes or secrets in the context. */
export const log = {
  info: (msg: string, ctx?: Context): void => console.log(line('info', msg, ctx)),
  error: (msg: string, ctx?: Context): void => console.error(line('error', msg, ctx)),
};
