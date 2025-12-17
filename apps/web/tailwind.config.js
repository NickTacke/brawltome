const { join } = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/*.{js,ts,jsx,tsx,mdx}'),
    // Shared UI package (classnames live here)
    join(__dirname, '../../libs/ui/src/**/*.{js,ts,jsx,tsx}'),
    // If the app resolves the built output in some environments, scan that too
    join(__dirname, '../../libs/ui/dist/**/*.{js,mjs,cjs}'),
  ],
};
