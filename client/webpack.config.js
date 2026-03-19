const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const BlobfuscationPlugin = require('./blobfuscator/blobfuscator-plugin');
const WebpackObfuscator = require('webpack-obfuscator');

const enableHardObfuscation = process.env.WARHEX_OBFUSCATE === '1';
const enableBlobfuscation = process.env.WARHEX_BLOBFUSCATE === '1';

module.exports = {
  mode: 'production',
  devtool: false,
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
            passes: 4, // Number of times to pass the file for optimization
          },
          mangle: {
            toplevel: true, // Mangle top-level variables and functions
            module: true, // Mangle variables in modules
            keep_classnames: false, // Mangle class names
            keep_fnames: false, // Mangle function names
            safari10: true,
          },
          format: {
            beautify: false, // Disable beautification
            comments: false,
          }
        },
        extractComments: false
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
   ...(enableBlobfuscation ? [
    new BlobfuscationPlugin({
      outputDir: path.join(__dirname, 'dist', 'blobfuscated'),
      includedWordsFilePath: path.join(__dirname, 'blobfuscator/includedWords.txt'),
      emitDebugFile: false,
    })
   ] : []),
   ...(enableHardObfuscation ? [
    new WebpackObfuscator(
      {
        compact: true,
        simplify: true,
        stringArray: true,
        stringArrayThreshold: 1,
        rotateStringArray: true,
        stringArrayEncoding: ['base64'],
        splitStrings: true,
        splitStringsChunkLength: 8,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.2,
        selfDefending: true,
        disableConsoleOutput: true,
      },
      []
    )
   ] : [])
  ],
};
