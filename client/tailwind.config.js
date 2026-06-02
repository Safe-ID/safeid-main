/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        safe: {
          bg: "#040C1A",
          card: "#071220",
          hover: "#0B1A2E",
          border: "#152338",
          borderL: "#1E3554",
          primary: "#1A6FFF",
          primaryD: "#1255CC",
          secondary: "#38BDF8",
          accent: "#86EFAC",
          text: "#EEF4FF",
          muted: "#7A9DC0",
          dim: "#3A5A80",
          danger: "#F87171",
          warn: "#FCD34D",
        }
      },
      animation: {
        'slide-up': 'slideUp 0.4s ease forwards',
        'fade-in': 'fadeIn 0.3s ease forwards',
      },
      keyframes: {
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}