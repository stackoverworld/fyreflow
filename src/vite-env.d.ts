/// <reference types="vite/client" />

declare const __FYREFLOW_APP_VERSION__: string;

interface DesktopNotificationPayload {
  title: string;
  body?: string;
}

interface DesktopNotificationResult {
  ok: boolean;
  reason?: "unsupported" | "invalid_payload";
}

interface DesktopRevealPathPayload {
  path: string;
}

interface DesktopRevealPathResult {
  ok: boolean;
  reason?: "invalid_payload" | "open_failed";
  message?: string;
}

interface Window {
  desktop?: {
    isElectron: boolean;
    platform: string;
    appVersion?: string;
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    notify: (payload: DesktopNotificationPayload) => Promise<DesktopNotificationResult>;
    revealPath: (payload: DesktopRevealPathPayload) => Promise<DesktopRevealPathResult>;
  };
}
