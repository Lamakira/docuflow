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
  // uiohook-napi is a native addon — webpack must not bundle it.
  // The runtime require() resolves to the unpacked node_modules (see asarUnpack in forge.config.ts).
  externals: {
    'uiohook-napi': 'commonjs uiohook-napi',
  },
};
