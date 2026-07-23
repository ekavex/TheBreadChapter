/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#FFF8F0',
          100: '#FFE8CC',
          200: '#FFD099',
          300: '#FFB866',
          400: '#FF9500',
          500: '#E67E00',
          600: '#B35F00',
          700: '#804400',
          800: '#4D2900',
          900: '#1A0E00',
        },
        surface: {
          DEFAULT: '#FAFAF8',
          raised: '#FFFFFF',
          overlay: '#F5F4F0',
        },
        ink: {
          DEFAULT: '#1A1A18',
          muted: '#6B6B65',
          faint: '#A8A8A0',
        },
        status: {
          new:     '#22C55E',
          making:  '#F59E0B',
          ready:   '#3B82F6',
          done:    '#6B7280',
          overdue: '#EF4444',
        }
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body:    ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'slide-up':   'slideUp 0.3s ease-out',
        'fade-in':    'fadeIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'ping-slow':  'ping 2s cubic-bezier(0,0,0.2,1) infinite',
      },
      keyframes: {
        slideUp:    { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:     { from: { opacity: '0' }, to: { opacity: '1' } },
        pulseSoft:  { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.6' } },
      },
    },
  },
  plugins: [],
}
