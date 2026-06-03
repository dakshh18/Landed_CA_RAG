import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./hooks/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Landed palette (from the design system screenshot)
        landed: {
          red: "#D52B1E",          // primary action — Canadian red
          "red-hover": "#B5241A",
          navy: "#26374A",         // headings, sidebar text, secondary buttons
          "navy-light": "#335075",  // accents, citation highlights
          ink: "#1F2937",          // body text
          muted: "#6B7280",        // secondary text
          border: "#E5E7EB",       // hairline borders
          bg: "#F9FAFB",           // page background
          card: "#FFFFFF",         // surfaces
          banner: "#26374A",       // disclaimer banner background
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 1px 0 rgb(0 0 0 / 0.06)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};

export default config;
