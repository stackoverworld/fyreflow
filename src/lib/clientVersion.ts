function normalizeVersion(raw: string | undefined): string {
  if (typeof raw !== "string") {
    return "";
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "";
}

export function getClientAppVersion(): string {
  const desktopVersion =
    typeof window !== "undefined" && window.desktop
      ? normalizeVersion(window.desktop.appVersion)
      : "";
  if (desktopVersion.length > 0) {
    return desktopVersion;
  }

  const bundledVersion =
    typeof __FYREFLOW_APP_VERSION__ === "string"
      ? normalizeVersion(__FYREFLOW_APP_VERSION__)
      : "";

  return bundledVersion || "dev";
}
