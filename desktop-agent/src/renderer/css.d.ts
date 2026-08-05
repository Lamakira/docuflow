/**
 * CSS files are handled by webpack (css-loader / MiniCssExtractPlugin) and by
 * vite in the harness. TypeScript tolerates a side-effect `import './x.css'`
 * without this, but not a dynamic `await import('./x.css')` — which the UI
 * switch in index.tsx needs so each UI pulls only its own stylesheet.
 */
declare module '*.css';
