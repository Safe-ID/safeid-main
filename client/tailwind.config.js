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
          // Texto branco sobre o azul precisa de 4,5:1 (WCAG AA): #1868F5 dá 4,84:1
          primary: "#1868F5",
          primaryD: "#1255CC",
          secondary: "#38BDF8",
          accent: "#86EFAC",
          text: "#EEF4FF",
          muted: "#7A9DC0",
          // Texto secundário: 5,1:1 sobre o card (WCAG AA pede 4,5:1; o tom antigo dava 2,65:1)
          dim: "#6488B0",
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