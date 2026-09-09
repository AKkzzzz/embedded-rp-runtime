import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = path.join(root, 'sources', 'rphub-official-presets.json');
const targetPath = path.join(root, 'ui', 'data', 'rphub-presets.js');
const presets = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

if (!Array.isArray(presets) || !presets.length) {
  throw new Error('RP-Hub official presets must be a non-empty array');
}

presets.forEach((preset, index) => {
  if (!preset || typeof preset !== 'object') throw new Error(`Preset ${index + 1} is not an object`);
  if (!String(preset.name || '').trim()) throw new Error(`Preset ${index + 1} has no name`);
  if (!String(preset.content || '').trim()) throw new Error(`Preset ${index + 1} has no content`);
  if (!['system', 'user', 'assistant'].includes(preset.role)) {
    throw new Error(`Preset ${index + 1} has invalid role: ${preset.role}`);
  }
});

const source = `(function () {
  'use strict';

  var attribution = {
    project: 'STA1N156/RP-Hub',
    source: 'https://github.com/STA1N156/RP-Hub',
    revision: 'b409ca6',
    version: '1.8.9',
    license: 'CC BY-NC 4.0',
    adapted: false,
    snapshot: 'sources/rphub-official-presets.json'
  };

  var officialPresets = ${JSON.stringify(presets, null, 2)};

  window.RPTemplateData.presets = officialPresets.map(function (preset, index) {
    var rootPreset = preset.role === 'system' && preset.name === '破限';
    return {
      id: 'rphub-official-' + String(index + 1).padStart(2, '0'),
      name: preset.name,
      role: preset.role,
      phase: preset.role === 'system' ? (rootPreset ? 'system-root' : 'system-support') : 'prelude',
      order: 1000 - index * 10,
      enabled: preset.enabled !== false,
      locked: false,
      source: attribution,
      content: preset.content
    };
  });
})();
`;

fs.writeFileSync(targetPath, source);
console.log(`Synced ${presets.length} official RP-Hub presets to ${path.relative(root, targetPath)}`);
