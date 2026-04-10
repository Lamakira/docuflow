module.exports = {
  entry: './src/main/index.ts',
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
