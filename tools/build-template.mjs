import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const uiRoot = path.join(root, 'ui');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'single-stage.manifest.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(root, 'card_src', 'core.json'), 'utf8'));
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'release', '内嵌RP运行时模板-v0.2-debug.json');

function read(relative) {
  return fs.readFileSync(path.join(uiRoot, relative), 'utf8');
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ratio(value) {
  const parts = String(value).split('/').map(Number);
  const result = parts.length === 2 && parts[1] ? parts[0] / parts[1] : Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`invalid ratio: ${value}`);
  return Number(result.toFixed(6));
}

function inlineUi() {
  let html = read('index.html');
  const cardContext = {
    name: core.name,
    personality: core.personality,
    scenario: core.scenario,
    mes_example: core.mes_example || ''
  };
  html = html.replace('</head>', `<script>window.RPCardContext=${JSON.stringify(cardContext).replace(/<\/script/gi, '<\\\\/script')};<\/script></head>`);
  html = html.replace(/\s*<link rel="stylesheet" href="([^"]+)">/g, (_match, href) => {
    return `<style>\n${read(href)}\n</style>`;
  });
  html = html.replace(/\s*<script src="([^"]+)"><\/script>/g, (_match, src) => {
    const source = read(src).replace(/<\/script/gi, '<\\/script');
    return `<script>\n${source}\n<\/script>`;
  });
  if (/\b(?:src|href)=["']https?:/i.test(html)) throw new Error('remote asset remained in UI');
  return html;
}

function launcher(inner) {
  const encoded = zlib.gzipSync(Buffer.from(inner)).toString('base64');
  const desktop = manifest.stage.desktop;
  const mobile = manifest.stage.mobile;
  const desktopRatio = ratio(desktop.aspectRatio);
  const mobileRatio = ratio(mobile.aspectRatio);
  const boot = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;background:#071012;color:#edf3ef}body{display:grid;place-items:center;font:14px system-ui}#boot{padding:24px;text-align:center}</style><div id="boot">正在启动卡内运行时……</div><script>;(async()=>{try{const b=Uint8Array.from(atob("${encoded}"),c=>c.charCodeAt(0));const h=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();document.open();document.write(h);document.close()}catch(e){document.getElementById("boot").innerHTML="<b>运行时载入失败</b><br><small>"+String(e&&e.message||e)+"</small>"}})();<\/script>`;
  return `<style>.embedded-rp-runtime-host{position:relative;left:50%;transform:translateX(-50%);width:min(${desktop.maxWidth}px,calc(100vw - ${desktop.viewportGap}px),calc((100svh - ${desktop.heightGap}px)*${desktopRatio}));aspect-ratio:${desktop.aspectRatio};min-width:0;overflow:hidden;background:#071012}.embedded-rp-runtime-host iframe{display:block;width:100%;height:100%;border:0}@media(max-width:${mobile.breakpoint}px){.embedded-rp-runtime-host{left:auto;transform:none;width:min(100%,calc((100svh - ${mobile.heightGap}px)*${mobileRatio}));max-width:none;aspect-ratio:${mobile.aspectRatio};margin:0 auto}}</style><div class="embedded-rp-runtime-host"><iframe sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" allow="fullscreen" allowfullscreen title="内嵌RP运行时模板" srcdoc="${escapeAttribute(boot)}"></iframe></div>`;
}

const inner = inlineUi();
const sourceHash = crypto.createHash('sha256').update(inner).digest('hex');
const replacement = launcher(inner);
const regex = manifest.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regexScript = {
  id: 'nanami-embedded-rp-runtime-launcher-v1',
  name: '内嵌RP运行时·单舞台启动器',
  scope: 'character',
  enabled: true,
  regex,
  flags: 'g',
  replacement,
  placement: [2],
  markdownOnly: true,
  promptOnly: false,
  minDepth: null,
  maxDepth: null,
  order: -1000
};

const card = {
  data: {
    ...core,
    uiTemplates: [],
    character_book: { entries: [] },
    extensions: {
      rp_hub_watermark: 'rp-hub',
      regex_scripts: [regexScript],
      rp_hub_ui_templates: [],
      embedded_runtime_manifest: {
        schemaVersion: manifest.schemaVersion,
        appId: manifest.appId,
        mode: manifest.mode,
        version: '0.2.0-debug',
        provenance: {
          owner: manifest.provenance && manifest.provenance.owner || 'AKkzzzz',
          projectType: manifest.provenance && manifest.provenance.projectType || 'RP-Hub 单正则 + 插件功能的小卡底层',
          license: manifest.provenance && manifest.provenance.license || 'Community Source-Available Non-Commercial',
          repositoryOwner: manifest.provenance && manifest.provenance.repositoryOwner || 'AKkzzzz',
          repository: manifest.provenance && manifest.provenance.repository || '',
          sourceNotice: manifest.provenance && manifest.provenance.sourceNotice || '',
          sourceHash: 'sha256:' + sourceHash
        }
      }
    }
  }
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(card));
console.log(JSON.stringify({
  output: path.relative(root, output),
  bytes: fs.statSync(output).size,
  innerBytes: Buffer.byteLength(inner),
  gzipBytes: zlib.gzipSync(Buffer.from(inner)).length,
  regexOwners: 1,
  worldbookInHost: 0,
  uiTemplatesInHost: 0
}, null, 2));
