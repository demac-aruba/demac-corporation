const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(path, oldText, newText, marker) {
  let text = read(path);
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required service-flow block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  write(path, text);
}
function insertAfter(path, anchor, insertion, marker) {
  let text = read(path);
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required service-flow anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  write(path, text);
}
function replaceRange(path, startMarker, endMarker, replacement, marker) {
  let text = read(path);
  if (text.includes(marker)) return;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Required service-flow range not found in ${path}: ${marker}`);
  text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  write(path, text);
}

module.exports = { read, write, replaceOnce, insertAfter, replaceRange };
