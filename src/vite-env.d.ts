/// <reference types="vite/client" />

interface DesktopNotificationPayload {
  title: string;
  body?: string;
}

interface DesktopNotificationResult {
  ok: boolean;
  reason?: "unsupported" | "invalid_payload";
}

interface Window {
  desktop?: {
    isElectron: boolean;
    platform: string;
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    notify: (payload: DesktopNotificationPayload) => Promise<DesktopNotificationResult>;
  };
}
