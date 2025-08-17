/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#F2811D",
          primaryMuted: "#F27127",
          accent: "#732002",
          bg: "#F2F2F2",
          surface: "#FFFFFF",
          ink: "#0D0D0D",
          inkMuted: "#505050",
          border: "#E6E6E6",
          success: "#22C55E",
          warning: "#F59E0B",
          error: "#EF4444",
          info: "#3B82F6"
        }
      },
      borderRadius: { xs: "6px", sm: "10px", md: "16px", lg: "20px" },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.06)",
        md: "0 4px 12px rgba(0,0,0,0.08)",
        lg: "0 10px 24px rgba(0,0,0,0.12)"
      }
    }
  },
  plugins: []
}
