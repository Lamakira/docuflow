const webpack = require('webpack');

module.exports = {
  entry: './src/main/index.ts',
  // Disable filesystem cache in production so webpack 5 doesn't keep file
  // watchers alive after compiler.run() — which would block process.exit().
  cache: process.env.NODE_ENV === 'production' ? false : { type: 'filesystem' },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  plugins: [
    // How a packaged release names its host (#236). A customer's machine has no
    // DOCUFLOW_API_URL and no ~/.docuflow-url, so before this the committed
    // DEFAULT_API_URL in src/lib/config.ts was the only thing an installer
    // could follow — which is why a production URL lived in this repository,
    // against ADR-0018. The URL now comes from the build environment and the
    // dist scripts refuse to run without it. Same trick, and the same reason,
    // as DOCUFLOW_UI in webpack.renderer.config.js.
    //
    // Deliberately NOT DOCUFLOW_API_URL: that one stays a real runtime lookup,
    // so `DOCUFLOW_API_URL=… npm run dev:v2` still works. Defining it here
    // would freeze it into the bundle and break the override.
    new webpack.DefinePlugin({
      'process.env.DOCUFLOW_DEFAULT_API_URL': JSON.stringify(
        process.env.DOCUFLOW_DEFAULT_API_URL ?? '',
      ),
    }),
  ],

  // uiohook-napi is a native addon — webpack must not bundle it.
  // The runtime require() resolves to the unpacked node_modules (see asarUnpack in forge.config.ts).
  externals: {
    'uiohook-napi': 'commonjs uiohook-napi',
  },
};
