const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {

	target: 'node',
	mode: 'production',

	entry: {
		index: './src/main.js',
	},

	resolve: {
		extensions: ['.js'],
		mainFields: ['main'],
	},

	output: {
		filename: '[name].js',
		path: path.resolve(__dirname, 'dist'),
		library: 'main',
		libraryTarget: 'commonjs2',
	},

	optimization: {
		minimize: true,
		minimizer: [
		new TerserPlugin({
			terserOptions: {
				output: {
					comments: false,
				},
			},
			sourceMap: true,
			extractComments: false,
		}),
		],
	},

	plugins: [new webpack.IgnorePlugin(/\/iconv-loader$/)]

};