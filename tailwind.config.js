/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark theme tokens
        bg: {
          base: 'var(--color-bg-base)',
          surface: 'var(--color-bg-surface)',
          raised: 'var(--color-bg-raised)',
          overlay: 'var(--color-bg-overlay)',
        },
        border: {
          subtle: 'var(--color-border-subtle)',
          default: 'var(--color-border-default)',
          strong: 'var(--color-border-strong)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
        },
        accent: {
          DEFAULT: '#E8590C',
          hover: '#D9480F',
          active: '#C23E0A',
          subtle: 'var(--color-accent-subtle)',
          border: 'var(--color-accent-border)',
        },
        status: {
          healthy: '#2F9E44',
          'healthy-bg': 'var(--color-healthy-bg)',
          warning: '#F59F00',
          'warning-bg': 'var(--color-warning-bg)',
          error: '#E03131',
          'error-bg': 'var(--color-error-bg)',
          neutral: '#868E96',
        }
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        subtle: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        overlay: '0 4px 20px -2px rgba(0, 0, 0, 0.3)',
      }
    },
  },
  plugins: [],
}
