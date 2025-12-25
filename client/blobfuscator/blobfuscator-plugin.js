const fs = require("fs");
const path = require("path");

class BlobfuscatorPlugin {
  constructor(options = {}) {
    this.options = options;
    this.index = 0;
  }

  obfuscateJS(code, includedWords, replacementWords, customComment, keyMapping, usedWords) {
    // Regular expression to match key-like variable names (including object properties)
    const regexKeyPattern = /(?<!\bstyle\.)(?<!https?:\/\/)\b[A-Za-z_]\w*-?\w*\b(?!['"])/g;
    const regexLicenseComment = /^\s*\/\*! For license information please see .*?\.LICENSE\.txt \*\//g;

    const delimiter = "_DELIMITER_";

    const generateBlobfuscatedName = () => {
      const uniqueIndex = this.index++;  // Unique index to generate different patterns
      const length = 50;  // Length of the generated name
      let result = "";
    
      // Use the unique index to generate a hashed pattern
      const indexPattern = uniqueIndex.toString(16).split('').map(digit => digit % 2 === 0 ? "$" : "_").join('');
    
      // Ensure the pattern fits within the desired length
      let pattern = indexPattern;
    
      // If the pattern is shorter than the desired length, fill with random "O" and "o"
      while (pattern.length < length) {
        pattern += Math.random() > 0.5 ? "$" : "_";
      }
    
      // If the pattern is too long, truncate it
      if (pattern.length > length) {
        pattern = pattern.slice(0, length);
      }
    
      result = "$$_$_$__$" + pattern + "$$_$_$__$";  // Final unique pattern based on the unique index
    
      return result;
    };

    // Remove license comments
    code = code.replace(regexLicenseComment, "");

    // Replace strings with delimiters
    let insideString = false;
    let resultCode = "";
    let currentString = "";

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (char === '"' && (i === 0 || code[i - 1] !== "\\")) {
        if (insideString) {
          resultCode += currentString.replace(/\s+/g, delimiter) + '"';
          insideString = false;
          currentString = "";
        } else {
          insideString = true;
          resultCode += char;
        }
      } else if (insideString) {
        currentString += char;
      } else {
        resultCode += char;
      }
    }

    // Replace only the included words
    code = resultCode.replace(regexKeyPattern, (match) => {
      if (includedWords.includes(match) && !keyMapping[match]) {
        keyMapping[match] = generateBlobfuscatedName(match);
        usedWords.add(match);
      }
      return keyMapping.hasOwnProperty(match) ? keyMapping[match] : match;
    });

    // Remove unnecessary spaces
    code = code.replace(/\s+/g, ' ').trim();

    // Replace delimiter back with spaces inside strings
    code = code.replace(new RegExp(`${delimiter}`, "g"), (match) => {
      return match.replace(new RegExp(delimiter, "g"), " ");
    });

    return customComment + code;
  }

  apply(compiler) {
    compiler.hooks.emit.tapAsync("BlobfuscatorPlugin", (compilation, callback) => {
      const includedWordsFilePath = path.join(__dirname, 'includedWords.txt');
      const includedWords = fs.readFileSync(includedWordsFilePath, "utf-8").split("\n").map(word => word.trim()).filter(Boolean);

      const customComment = `/*! 
* Copyright (c) 2025 Blobl.io
* 
* This software is part of Blobl.io, a game developed by Eric Wolf.
* The code has been obfuscated using Blobfuscator, a custom obfuscation tool.
* 
* All rights reserved. Unauthorized reproduction, modification, distribution,
* or use of this software is prohibited.
* 
* For inquiries, please contact: contact.blobl@gmail.com.
*/\n\n`;

      const replacementWords = ["blob"];
      const usedWords = new Set();
      const keyMapping = {};

      for (const filename in compilation.assets) {
        if (filename.endsWith(".js")) {
          let code = compilation.assets[filename].source();
          code = this.obfuscateJS(code, includedWords, replacementWords, customComment, keyMapping, usedWords);

          compilation.assets[filename] = {
            source: () => code,
            size: () => code.length
          };
        }
      }

      fs.writeFileSync("blobfuscator/debug.txt", "", "utf-8");
      fs.appendFileSync("blobfuscator/debug.txt", `Key-Mapping:\n` + JSON.stringify(keyMapping, null, 2) + "\n", "utf-8");

      const unusedWords = includedWords.filter(word => !usedWords.has(word));
      if (unusedWords.length > 0) {
        const text = `\nUnused Words:\n${unusedWords.join(", ")}\n\n`;
        fs.writeFileSync("blobfuscator/debug.txt", text + fs.readFileSync("blobfuscator/debug.txt", "utf-8"));
      }

      callback();
    });
  }
}

module.exports = BlobfuscatorPlugin;
