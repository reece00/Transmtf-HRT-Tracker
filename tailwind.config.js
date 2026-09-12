/** @type {import('tailwindcss').Config} */
// Previously the app loaded https://cdn.tailwindcss.com with NO inline
// tailwind.config (see index.html history), i.e. the default theme. This
// local config therefore keeps the default theme and only points the
// content scanner at the real source files.
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
