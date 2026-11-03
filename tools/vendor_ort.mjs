import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const dst = join(root, 'vendor', 'ort')
const files = ['ort.min.mjs', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']

if (!existsSync(src)) {
  console.error('onnxruntime-web がありません。npm install を先に実行してください')
  process.exit(1)
}
mkdirSync(dst, { recursive: true })
for (const f of files) {
  copyFileSync(join(src, f), join(dst, f))
  console.log('copied', f)
}
