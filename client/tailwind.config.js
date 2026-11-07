/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Visual "cometas" (nov/2026): fundo azul-noite, verde-proteção e luz de cometa
        safe: {
          bg: "#0A0F1C",
          card: "#0F1626",
          hover: "#131C30",
          border: "#1E2840",
          borderL: "#2A3654",
          // Botões: texto branco sobre o verde precisa de 4,5:1 (WCAG AA): #1A7F5C dá 4,96:1
          primary: "#1A7F5C",
          primaryD: "#16704F",
          // Verde de destaque em texto e links: 9:1 sobre o fundo
          secondary: "#4CC99A",
          // Luz dos cometas e do cadeado (só decoração e ícones)
          accent: "#6FE3B4",
          text: "#EEF1F7",
          muted: "#A3ACC2",
          // Texto secundário: 6:1 sobre o card
          dim: "#8690AA",
          danger: "#F87171",
          warn: "#FCD34D",
        }
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        serif: ['"Fraunces Variable"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
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