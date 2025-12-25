const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const BlobfuscationPlugin = require('./blobfuscator/blobfuscator-plugin');

module.exports = {
  mode: 'production',
  entry: './src/index.js',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  optimization: {
    minimize: true, 
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true, // Remove console statements
            drop_debugger: true, // Remove debugger statements
            passes: 3, // Number of times to pass the file for optimization
          },
          mangle: {
            toplevel: false, // Mangle top-level variables and functions
            module: false, // Mangle variables in modules
            keep_classnames: false, // Mangle class names
            keep_fnames: false, // Mangle function names
          },
          format: {
            beautify: false, // Disable beautification
          }
        },
        extractComments: true 
      }),
    ]
  },
  module: {
    rules: [
      /*{
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          },
        }
      },*/
      {
        test: /\.worker\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'worker-loader',
            options: {
              filename: 'index.worker.js'
            }
          }
        ],
      },
    ]
  },
  plugins: [
   new BlobfuscationPlugin({
      outputDir: path.join(__dirname, 'dist', 'blobfuscated'),
      includedWordsFilePath: path.join(__dirname, 'blobfuscator/includedWords.txt'),
   })
  ],
};
