"use strict";

// debug mode
const isDebug = false;

var fs = require('fs');
var _ = require('lodash');
var path = require('path');
var ConcatSource = require("webpack/lib/ConcatSource");

function HtmlResWebpackPlugin(options) {
	this.options = _.extend({
		hash: null, // standard hash format
		chunkhash: null, // chunk hash format
		jsHash: options.jsHash || '',
		cssHash: options.cssHash || '',
		isWatch: false, // webpack watching mode or not
	}, options);
}

HtmlResWebpackPlugin.prototype.apply = function(compiler, callback) {
	let _this = this;

	this.options = _.extend(this.options, {isWatch: compiler.options.watch || false})

  	compiler.plugin("make", function(compilation, callback) {
	    isDebug && console.log("==================make================");
	    callback();
	});


  	// right after emit, files will be generated
	compiler.plugin("emit", function(compilation, callback) {
	    isDebug && console.log("===================emit===============");

	    // return basename, ie, /xxx/xxx.html return xxx.html
	    _this.options.basename = _this.addFileToWebpackAsset(compilation, _this.options.template);

	    _this.findAssets(compilation);

	    if (!_this.options.isWatch) {
	    	_this.processHashFormat();
	    }

	    _this.addAssets(compilation);

	    
	    callback();
	});

};

// use webpack to generate files when it is in dev mode
HtmlResWebpackPlugin.prototype.addFileToWebpackAsset = function(compilation, template) {
	var filename = path.resolve(template);
	var basename = path.basename(filename);
    compilation.fileDependencies.push(filename);
    compilation.assets[basename] = {
    	source: function() {
      		return fs.readFileSync(filename).toString();
      	},
      	size: function() {
      		return fs.statSync(filename).size;
      	}
    };
    return basename;
};

// map those html-related resources in an array
HtmlResWebpackPlugin.prototype.getResourceMapping = function(compilation) {
	let resArr = [];
	let stats = this.AssetOptions.stats;

	stats.chunks.forEach(function(item, key) {
		resArr.push({files: item.files, hash: item.hash});
	});

	this.AssetOptions = _.assign(
		this.AssetOptions,
		{resArr: resArr}
	);

};

// process hash format
HtmlResWebpackPlugin.prototype.processHashFormat = function() {
	let hashFormat = this.options.hash || this.options.chunkhash;

	let hashRegex = new RegExp("(hash|chunkhash)(:)*[0-9]*");

	let jsHashMath = this.options.jsHash.match(hashRegex);
	let cssHashMath = this.options.cssHash.match(hashRegex);

	let jsHashInfo = (jsHashMath) ? (jsHashMath[0].split(':') || []) : [];
	let cssHashInfo = (cssHashMath) ? (cssHashMath[0].split(':') || []) : [];

	this.AssetOptions = _.assign(
		this.AssetOptions,
		{jsHashInfo: jsHashInfo},
		{cssHashInfo: cssHashInfo}
	);
}

// find resources related the html
HtmlResWebpackPlugin.prototype.findAssets = function(compilation) {

	this.AssetOptions = _.assign(
		{webpackOptions: compilation.options},
		{stats: compilation.getStats().toJson()}
	);

	this.getResourceMapping();

};


// inline and md5 resources for prod and add prefix for dev
HtmlResWebpackPlugin.prototype.addAssets = function(compilation) {
	let stats = compilation.getStats().toJson();

	let dest = this.AssetOptions.webpackOptions.output.path;
	let tplPath = path.resolve(this.options.template);
	let htmlContent = compilation.assets[this.options.basename].source();

	//
	if (!this.options.isWatch) {
		let scriptInlineRegex = new RegExp("<script.*src=[\"|\']*(.+)[\?]\_\_inline.*?[\"|\']><\/script>", "ig");
		htmlContent = this.inlineRes(scriptInlineRegex, 'script', 'js', compilation, htmlContent);
		
		let styleInlineRegex = new RegExp("<link.*href=[\"|\']*(.+)[\?]\_\_inline.*?[\"|\']>", "ig");
		htmlContent = this.inlineRes(styleInlineRegex, 'style', 'css', compilation, htmlContent);

		let scriptMd5Regex = new RegExp("<script.*src=[\"|\']*(.+).*?[\"|\']><\/script>", "ig");
		htmlContent = this.md5Res(scriptMd5Regex, compilation, htmlContent);

		let styleMd5Regex = new RegExp("<link.*href=[\"|\']*(.+).*?[\"|\']>", "ig");
		htmlContent = this.md5Res(styleMd5Regex, compilation, htmlContent);
	}
	else {
		let scriptMd5Regex = new RegExp("<script.*src=[\"|\']*(.+).*?[\"|\']><\/script>", "ig");
		htmlContent = this.addPrefix(scriptMd5Regex, compilation, htmlContent);
		
		let styleMd5Regex = new RegExp("<link.*href=[\"|\']*(.+).*?[\"|\']>", "ig");
		htmlContent = this.addPrefix(styleMd5Regex, compilation, htmlContent);
	}

	compilation.assets[this.options.basename].source = function() {
		return htmlContent;
	};

	return htmlContent;
};

// check if script / link is in entry
HtmlResWebpackPlugin.prototype.getNormalFile = function(opt, compilation) {
	let resArr = this.AssetOptions.resArr,
		route = opt.route;

	for (let key in resArr) {
		for (let item of resArr[key].files) {
			if (!!~route.indexOf(item)) {
				return route;
			}
		}
	}
};	

// get the targeted hash file name
HtmlResWebpackPlugin.prototype.getHashedFile = function(opt, compilation) {
	// console.log(opt);
	var options = this.options;
	var ext = opt.ext;
	var hashFormat = (opt.ext === '.js') ? options.jsHash : options.cssHash,
		hashInfo = (opt.ext === '.js') ? opt.jsHashInfo : opt.cssHashInfo,
		resArr = this.AssetOptions.resArr,
		route = opt.route,
		bits = (hashInfo.length > 1) ? hashInfo[1] : (compilation.hash.length),
		isHash = (!~hashFormat.indexOf('chunkhash'));
	var usedHash = compilation.hash.substr(0, bits);

	isDebug && console.log(hashFormat, hashInfo, bits, isHash, usedHash);
	
	for (let key in resArr) {
		for (let item of resArr[key].files) {
			usedHash = (isHash) ? usedHash : resArr[key].hash.substr(0, bits);
			let replaceRegx = '[' + hashInfo[0];
			replaceRegx += (hashInfo.length > 1) ? ':' + hashInfo[1] + ']' : ']';

			let newRoute = hashFormat.replace(replaceRegx, usedHash)
									 .replace('[name]', route.replace(ext, ''));

			isDebug && console.log(item, newRoute, !!~item.indexOf(newRoute));

			if (!!~item.indexOf(newRoute)) {
				return newRoute;
			}
		}
	}
};

HtmlResWebpackPlugin.prototype.addPrefix = function(regex, compilation, htmlContent) {

	var _this = this;
	var AssetOptions = this.AssetOptions;
	
	return htmlContent.replace(regex, function(script, route) {
		
		let file = _this.getNormalFile({
			route: route,
		}, compilation);

		if (file) {
			return script.replace(route, AssetOptions.webpackOptions.output.publicPath + route);
		}

		return script;
	});

};

// inline resources
HtmlResWebpackPlugin.prototype.inlineRes = function(regex, htmlTag, ext, compilation, htmlContent) {
	var _this = this;
	var AssetOptions = this.AssetOptions;

	return htmlContent.replace(regex, function(res, route) {
		let hashFile = _this.getHashedFile({
			jsHashInfo: AssetOptions.jsHashInfo,
			cssHashInfo: AssetOptions.cssHashInfo,
			route: route,
			ext: path.extname(route)
		}, compilation);

  		if (hashFile) {
  			let returnVal = (htmlTag === "script") ? compilation.assets[hashFile].source() : compilation.assets[hashFile].children[1]._value;
  			// don't need it anymore
  			delete compilation.assets[hashFile]
  			return "<" + htmlTag + ">" +  returnVal  + "</" + htmlTag + ">";
  		}
  		else {
  			return res;
  		}
        
    });
};

// md5 resources
HtmlResWebpackPlugin.prototype.md5Res = function(regex, compilation, htmlContent) {
	var _this = this;
	var AssetOptions = this.AssetOptions;
	
	return htmlContent.replace(regex, function(script, route) {

		let hashFile = _this.getHashedFile({
			jsHashInfo: AssetOptions.jsHashInfo,
			cssHashInfo: AssetOptions.cssHashInfo,
			route: route,
			ext: path.extname(route)
		}, compilation);

		if (hashFile) {
			return script.replace(route, AssetOptions.webpackOptions.output.publicPath + hashFile);
		}
		return script;
	});
};

module.exports = HtmlResWebpackPlugin;