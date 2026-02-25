import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  define: {
    __FYREFLOW_APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev")
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173
  }
}));
