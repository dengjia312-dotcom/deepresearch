import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F8FAFC',
        surface: {
          DEFAULT: '#FAF8FF',
          lowest: '#FFFFFF',
          low: '#F3F3FE',
          container: '#EDEDF9',
          high: '#E7E7F3',
          highest: '#E1E2ED',
        },
        ink: {
          DEFAULT: '#191B23',
          muted: '#434655',
          subtle: '#737686',
        },
        primary: {
          DEFAULT: '#2563EB',
          deep: '#004AC6',
          soft: '#EFF6FF',
          fixed: '#DBE1FF',
        },
        outline: {
          DEFAULT: '#E2E8F0',
          strong: '#C3C6D7',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'PingFang SC',
          'Microsoft YaHei',
          'Noto Sans CJK SC',
          'system-ui',
          'sans-serif',
        ],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        ambient:
          '0 4px 6px -1px rgb(15 23 42 / 0.06), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        panel: '0 1px 2px rgb(15 23 42 / 0.03)',
      },
      spacing: {
        sidebar: '260px',
        topbar: '56px',
      },
    },
  },
  plugins: [],
} satisfies Config
