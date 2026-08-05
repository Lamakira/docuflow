const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');

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
      {
        // Self-hosted UI fonts referenced by url() in tokens.css. Without this
        // rule css-loader cannot resolve them and the renderer build fails.
        test: /\.(woff2?|ttf|otf|eot)$/,
        type: 'asset/resource',
        generator: { filename: 'fonts/[name][ext]' },
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: '[name].css' }),
    // Lets `DOCUFLOW_UI=v2 npm run dev` pick the UI at build time, so showing
    // the redesign doesn't require editing source or opening DevTools. The
    // localStorage key still wins at runtime.
    new webpack.DefinePlugin({
      'process.env.DOCUFLOW_UI': JSON.stringify(process.env.DOCUFLOW_UI ?? ''),
    }),
  ],
};
