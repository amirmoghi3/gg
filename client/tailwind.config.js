/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "'Trebuchet MS'", "sans-serif"],
        body: ["'Trebuchet MS'", "sans-serif"]
      },
      colors: {
        ink: {
          900: "#0e1116",
          800: "#121a24",
          700: "#1b2b3a",
          500: "#2b3d52"
        },
        aura: {
          400: "#6ee7ff",
          500: "#3aa6ff"
        }
      },
      boxShadow: {
        panel: "0 20px 40px rgba(0, 0, 0, 0.35)",
        glow: "0 0 18px rgba(110, 231, 255, 0.25)"
      }
    }
  },
  plugins: []
};
