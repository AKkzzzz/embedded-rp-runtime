import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'release', '内嵌RP运行时模板-v0.1-debug.json');
const output = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(root, 'qa', 'template-card-preview.html');
const payload = JSON.parse(fs.readFileSync(target, 'utf8'));
const replacement = payload.data.extensions.regex_scripts[0].replacement;

const preview = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>内嵌 RP 运行时模板 · 卡片预览</title>
  <style>
    html,body{margin:0;min-height:100%;background:#111;color:#eee;font-family:system-ui}
    .message{width:min(1360px,100%);margin:0 auto;padding:18px 0}
  </style>
</head>
<body>
  <article class="message">${replacement}</article>
</body>
</html>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, preview);
console.log(path.relative(root, output));
