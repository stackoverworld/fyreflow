/// <reference types="vite/client" />

interface Window {
  desktop?: {
    isElectron: boolean;
    platform: string;
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
  };
}
