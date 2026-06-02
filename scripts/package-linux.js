#!/usr/bin/env node
// Prepares dist/linux/ for Linux deployment:
//   dist/linux/web/    ← built React client (from dist/web/)
//   dist/linux/server/ ← server source (from server/, without node_modules)

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const webSrc = path.join(root, 'dist', 'web')
const serverSrc = path.join(root, 'server')
const outDir = path.join(root, 'dist', 'linux')
const webDst = path.join(outDir, 'web')
const serverDst = path.join(outDir, 'server')

if (!fs.existsSync(webSrc)) {
  console.error('ERROR: dist/web/ not found — run npm run build:web first')
  process.exit(1)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

copyDir(webSrc, webDst)
copyDir(serverSrc, serverDst, ['node_modules'])

fs.writeFileSync(path.join(outDir, 'README.txt'), [
  'TVTab Server — Linux',
  '',
  'Setup:',
  '  cd server',
  '  npm install',
  '',
  'Start:',
  '  node src/index.js [--port 3001] [--data-dir ./data]',
  '',
  'The web client is served automatically from ../web/',
  'Open http://localhost:3001 in your browser.',
].join('\n'))

console.log('✓ dist/linux/ ready')
console.log('  web/    —', countFiles(webDst), 'files')
console.log('  server/ —', countFiles(serverDst), 'files')

function copyDir(src, dst, exclude = []) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    if (exclude.includes(entry)) continue
    const s = path.join(src, entry)
    const d = path.join(dst, entry)
    if (fs.statSync(s).isDirectory()) copyDir(s, d, exclude)
    else fs.copyFileSync(s, d)
  }
}

function countFiles(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e)
    n += fs.statSync(p).isDirectory() ? countFiles(p) : 1
  }
  return n
}
