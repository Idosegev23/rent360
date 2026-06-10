/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // New design tokens (rent360 editorial)
        paper: "#FAF6F0",
        "paper-2": "#F3ECE0",
        "paper-3": "#ECE3D2",
        card: "#FFFFFF",
        line: "#E8DFCE",
        "line-2": "#D9CFB9",
        "line-3": "#C2B69D",
        ink: {
          DEFAULT: "#1A1612",
          2: "#3A332C",
          3: "#6B6259",
          4: "#9C9389",
          5: "#BDB4A8"
        },
        // Remap Tailwind's cool default gray to the warm palette, so every existing
        // text-gray-*/bg-gray-*/border-gray-* across the app matches the editorial look.
        gray: {
          50: "#FAF6F0", 100: "#F3ECE0", 200: "#E8DFCE", 300: "#D9CFB9",
          400: "#BDB4A8", 500: "#9C9389", 600: "#6B6259", 700: "#3A332C",
          800: "#241E18", 900: "#1A1612"
        },
        // Semantic colors with -soft variants
        green: { DEFAULT: "#14826E", soft: "#DDEEEA" },
        amber: { DEFAULT: "#D9881E", soft: "#FFEAD0" },
        red: { DEFAULT: "#C73E3E", soft: "#FBE4E4" },
        blue: { DEFAULT: "#2D5BD7", soft: "#E1E8F8" },
        purple: { DEFAULT: "#6F4FB8", soft: "#EAE2F5" },
        // Brand — warm terracotta orange (re-aliased to new system)
        brand: {
          DEFAULT: "#FF6B35",
          deep: "#C04A1F",
          darker: "#7A2D0F",
          soft: "#FFE8DC",
          glow: "#FFB89A",
          tint: "#FFF4ED",
          // BACKCOMPAT aliases (existing code uses brand-primary/bg/surface/ink/border)
          primary: "#FF6B35",
          primaryMuted: "#C04A1F",
          accent: "#7A2D0F",
          bg: "#FAF6F0",
          surface: "#FFFFFF",
          ink: "#1A1612",
          inkMuted: "#6B6259",
          border: "#E8DFCE",
          success: "#14826E",
          warning: "#D9881E",
          error: "#C73E3E",
          info: "#2D5BD7"
        }
      },
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "14px",
        lg: "20px",
        xl: "28px"
      },
      boxShadow: {
        "sh-1": "0 1px 2px rgba(26,22,18,0.04), 0 1px 1px rgba(26,22,18,0.02)",
        "sh-2": "0 2px 8px rgba(26,22,18,0.06), 0 1px 2px rgba(26,22,18,0.04)",
        "sh-3": "0 8px 24px rgba(26,22,18,0.08), 0 2px 6px rgba(26,22,18,0.04)",
        "sh-4": "0 24px 48px rgba(26,22,18,0.12), 0 4px 12px rgba(26,22,18,0.06)",
        "sh-brand": "0 10px 32px -8px rgba(255,107,53,0.45), 0 4px 12px -4px rgba(255,107,53,0.25)",
        // Aliases for existing code
        sm: "0 1px 2px rgba(26,22,18,0.04), 0 1px 1px rgba(26,22,18,0.02)",
        md: "0 2px 8px rgba(26,22,18,0.06), 0 1px 2px rgba(26,22,18,0.04)",
        lg: "0 8px 24px rgba(26,22,18,0.08), 0 2px 6px rgba(26,22,18,0.04)"
      },
      fontFamily: {
        display: ["var(--font-display)", "Frank Ruhl Libre", "Georgia", "serif"],
        ui: ["var(--font-ui)", "Assistant", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
        sans: ["var(--font-ui)", "Assistant", "system-ui", "sans-serif"]
      },
      letterSpacing: {
        tightish: "-0.01em",
        tighter2: "-0.015em",
        tighter3: "-0.025em"
      }
    }
  },
  plugins: []
}
