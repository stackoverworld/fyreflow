import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Manrope'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"]
      },
      colors: {
        ink: {
          50: "rgb(var(--ink-50) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          950: "rgb(var(--ink-950) / <alpha-value>)",
        },
        ember: {
          50: "#fdf0eb",
          100: "#faded1",
          200: "#f5bda8",
          300: "#ec9a7d",
          400: "#e38860",
          500: "#d97757",
          600: "#c46849",
          700: "#a2523a",
          800: "#7f3f2e",
          900: "#633226",
          950: "#3d1f17",
        }
      },
      boxShadow: {
        panel: "0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.2)",
        focus: "0 0 0 3px rgba(217, 119, 87, 0.25)"
      },
      animation: {
        rise: "rise 300ms ease-out both",
        pulsebar: "pulsebar 1.4s ease-in-out infinite"
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        pulsebar: {
          "0%, 100%": { transform: "scaleX(0.92)", opacity: "0.45" },
          "50%": { transform: "scaleX(1)", opacity: "1" }
        }
      }
    }
  },
  plugins: []
} satisfies Config;
