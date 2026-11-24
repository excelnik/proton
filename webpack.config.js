const path = require('path')

module.exports = (_env, argv = {}) => {
  const mode = argv.mode || 'development'

  return {
    entry: './src/index.jsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
    },
    mode,
    devtool: mode === 'development' ? 'source-map' : false,
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/preset-react'],
            },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.js', '.jsx'],
    },
    target: 'electron-renderer',
    externals: {
      'better-sqlite3': 'commonjs better-sqlite3',
      'fs': 'commonjs fs',
      'path': 'commonjs path',
      'os': 'commonjs os',
    },
  }
}
