/** @type {import('tailwindcss').Config} */

// Every colour is a CSS variable holding "R G B" channels, set in src/index.css.
// The variables change with context (charcoal shell vs warm panel) and with prefers-color-scheme,
// so components only ever name a meaning: ink, slate, verdigris (money in), oxblood (debt), magenta (primary action).
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        shell: v('shell'),
        panel: v('panel'),
        paper: { DEFAULT: v('paper'), deep: v('paper-deep') },
        ink: { DEFAULT: v('ink'), soft: v('ink-soft') },
        slate: { DEFAULT: v('slate') },
        rule: v('rule'),
        verdigris: { DEFAULT: v('verdigris'), soft: v('verdigris-soft') },
        oxblood: { DEFAULT: v('oxblood'), soft: v('oxblood-soft') },
        magenta: { DEFAULT: v('magenta'), deep: v('magenta-deep') },
        amber: { DEFAULT: v('amber'), soft: v('amber-soft') },
        focus: v('focus'),
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Public Sans Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: { panel: '1.75rem' },
      maxWidth: { prose: '68ch' },
    },
  },
  plugins: [],
}
