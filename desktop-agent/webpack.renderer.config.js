const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  // Disable filesystem cache in production so webpack 5 doesn't keep file
  // watchers alive after compiler.run() — which would block process.exit().
  cache: process.env.NODE_ENV === 'production' ? false : { type: 'filesystem' },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript',
            ],
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: '[name].css' }),
  ],
};
