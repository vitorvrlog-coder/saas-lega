#!/usr/bin/env node
/* build.js — gera dist/falcao-simulador.html: um único arquivo com CSS, JS e Three.js embutidos.
 * Uso: node build.js */
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  const css = fs.readFileSync(path.join(root, href), 'utf8');
  return '<style>\n' + css + '\n</style>';
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const js = fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>\n' + js + '\n</script>';
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'falcao-simulador.html');
fs.writeFileSync(out, html);
console.log('Gerado:', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
