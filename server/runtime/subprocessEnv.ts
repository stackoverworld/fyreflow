const DEFAULT_ALLOWED_ENV_KEYS = [
  "CI",
  "COLORTERM",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "PWD",
  "SHELL",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER"
] as const;

const DEFAULT_ALLOWED_ENV_PREFIXES = [
  "LC_"
] as const;

function shouldIncludeEnvKey(key: string): boolean {
  return (
    DEFAULT_ALLOWED_ENV_KEYS.includes(key as (typeof DEFAULT_ALLOWED_ENV_KEYS)[number]) ||
    DEFAULT_ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function buildRestrictedSubprocessEnv(
  extraEnv?: Record<string, string>,
  sourceEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (!shouldIncludeEnvKey(key) || typeof value !== "string" || value.length === 0) {
      continue;
    }
    env[key] = value;
  }

  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    if (typeof value !== "string") {
      continue;
    }
    env[key] = value;
  }

  return env;
}
