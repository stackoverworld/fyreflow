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
          50: "#f8f8fa",
          100: "#eeeff2",
          200: "#dddde2",
          300: "#c5c5cc",
          400: "#9a9aa3",
          500: "#6b6b73",
          600: "#4a4a4e",
          700: "#363638",
          800: "#262628",
          900: "#1a1a1c",
          950: "#131314",
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
