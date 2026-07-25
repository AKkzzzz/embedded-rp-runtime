(function () {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function canonical() {
    return window.RPStorage.getCanonical();
  }

  function authoredById(id) {
    return window.RPTemplateData.worldbook.find(function (entry) { return entry.id === id; }) || null;
  }

  function localById(state, id) {
    return (state.knowledge.entries || []).find(function (entry) { return entry.id === id; }) || null;
  }

  function validateEntry(entry) {
    var errors = [];
    if (!entry || typeof entry !== 'object') return ['entry must be an object'];
    var normalized = window.RPWorldbook.normalizeEntry(entry, 0);
    if (!/^[a-z0-9][a-z0-9._-]{2,119}$/i.test(entry.id || '')) errors.push('entry.id is invalid');
    if (!String(normalized.name || '').trim()) errors.push('entry.name is required');
    if (!String(normalized.content || '').trim()) errors.push('entry.content is required');
    if (String(normalized.content || '').length > 30000) errors.push('entry.content exceeds 30000 characters');
    if (['user', 'memory-derived', 'imported'].indexOf(normalized.source) === -1) errors.push('entry.source is invalid');
    var trigger = normalized.trigger || {};
    if (['constant', 'literal', 'regex', 'state', 'semantic'].indexOf(trigger.type) === -1) errors.push('entry.trigger.type is invalid');
    if (trigger.type === 'literal' && !(trigger.keys || []).length) errors.push('literal trigger needs keys');
    if (trigger.type === 'regex' && !(trigger.patterns || []).length) errors.push('regex trigger needs patterns');
    var rawProbability = entry.probability === undefined ? 100 : Number(entry.probability);
    if (!Number.isFinite(rawProbability) || rawProbability < 0 || rawProbability > 100) errors.push('entry.probability is outside 0..100');
    var rawScanDepth = entry.scanDepth !== undefined ? entry.scanDepth : entry.scan_depth;
    if (rawScanDepth !== undefined && rawScanDepth !== null && (!Number.isFinite(Number(rawScanDepth)) || Number(rawScanDepth) < 0)) {
      errors.push('entry.scanDepth must be non-negative');
    }
    if (normalized.dependencies.indexOf(normalized.id) !== -1) errors.push('entry cannot depend on itself');
    return errors;
  }

  function validateProposalCore(proposal) {
    var state = canonical();
    var errors = [];
    if (!proposal || typeof proposal !== 'object') return { ok: false, errors: ['proposal must be an object'] };
    if (Number(proposal.baseRevision) !== Number(state.knowledge.revision)) errors.push('baseRevision conflict');
    if (!String(proposal.reason || '').trim()) errors.push('reason is required');
    if (!Array.isArray(proposal.evidenceMessageIds) || !proposal.evidenceMessageIds.length) errors.push('evidenceMessageIds are required');
    if (!Array.isArray(proposal.operations) || !proposal.operations.length) errors.push('operations are required');
    (proposal.operations || []).forEach(function (operation, index) {
      if (!operation || ['add', 'replace', 'disable'].indexOf(operation.op) === -1) {
        errors.push('operations[' + index + '].op is invalid');
        return;
      }
      if (operation.op === 'add') {
        validateEntry(operation.entry).forEach(function (error) { errors.push('operations[' + index + ']: ' + error); });
        if (operation.entry && operation.entry.source !== 'memory-derived') errors.push('model add may only create memory-derived entries');
        if (operation.entry && (authoredById(operation.entry.id) || localById(state, operation.entry.id))) errors.push('entry id already exists: ' + operation.entry.id);
      } else {
        var targetId = String(operation.id || '');
        var authored = authoredById(targetId);
        var local = localById(state, targetId);
        if (!authored && !local) errors.push('target entry missing: ' + targetId);
        if (authored && authored.locked) errors.push('target entry is author-locked: ' + targetId);
        if (local && local.locked) errors.push('target entry is locked: ' + targetId);
        if (operation.op === 'replace') {
          validateEntry(operation.entry).forEach(function (error) { errors.push('operations[' + index + ']: ' + error); });
          if (operation.entry && operation.entry.id !== targetId) errors.push('replace cannot change entry id');
        }
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  window.RPPlugins.attach('runtime.patch.guard', {
    validateProposal: validateProposalCore,
    validateState: function (payload) {
      return window.RPStateGuard.validate(payload.value, payload.schema);
    }
  });

  function validateProposal(proposal) {
    if (!window.RPPlugins.isEnabled('runtime.patch.guard')) {
      return { ok: false, errors: ['model patch guard plugin is disabled'] };
    }
    var result = window.RPPlugins.call('runtime.patch.guard', 'validateProposal', proposal);
    if (result.error) return { ok: false, errors: [String(result.error.message || result.error)] };
    return result.value;
  }

  function propose(proposal) {
    var validation = validateProposal(proposal);
    if (!validation.ok) return validation;
    var state = canonical();
    var normalized = clone(proposal);
    normalized.id = normalized.id || 'wb-proposal-' + Date.now();
    normalized.status = 'pending';
    normalized.createdAt = new Date().toISOString();
    state.knowledge.pendingProposals = state.knowledge.pendingProposals.concat([normalized]);
    var whole = window.RPStateGuard.validate(state, window.RPTemplateData.stateSchema);
    if (!whole.ok) return whole;
    window.RPStorage.saveCanonical(state);
    window.RPEvents.emit('worldbook:proposal:created', clone(normalized));
    return { ok: true, proposal: normalized };
  }

  function commit(id) {
    var state = canonical();
    var proposal = state.knowledge.pendingProposals.find(function (item) { return item.id === id; });
    if (!proposal || proposal.status !== 'pending') return { ok: false, errors: ['pending proposal not found'] };
    var validation = validateProposal(proposal);
    if (!validation.ok) return validation;
    var entries = state.knowledge.entries.slice();
    proposal.operations.forEach(function (operation) {
      if (operation.op === 'add') {
        entries.push(Object.assign({
          enabled: true,
          locked: false,
          order: 100,
          placement: 'before_character',
          dependencies: []
        }, clone(operation.entry)));
      } else {
        var index = entries.findIndex(function (entry) { return entry.id === operation.id; });
        if (operation.op === 'replace' && index >= 0) entries[index] = clone(operation.entry);
        if (operation.op === 'disable' && index >= 0) entries[index].enabled = false;
      }
    });
    state.knowledge.entries = entries;
    state.knowledge.revision += 1;
    proposal.status = 'accepted';
    proposal.acceptedAt = new Date().toISOString();
    var whole = window.RPStateGuard.validate(state, window.RPTemplateData.stateSchema);
    if (!whole.ok) return whole;
    window.RPStorage.saveCanonical(state);
    window.RPEvents.emit('worldbook:proposal:committed', { id: id, revision: state.knowledge.revision });
    return { ok: true, revision: state.knowledge.revision };
  }

  function reject(id) {
    var state = canonical();
    var proposal = state.knowledge.pendingProposals.find(function (item) { return item.id === id; });
    if (!proposal || proposal.status !== 'pending') return false;
    proposal.status = 'rejected';
    proposal.rejectedAt = new Date().toISOString();
    window.RPStorage.saveCanonical(state);
    window.RPEvents.emit('worldbook:proposal:rejected', { id: id });
    return true;
  }

  function saveLocal(entry) {
    var state = canonical();
    var normalized = window.RPWorldbook.normalizeEntry(Object.assign({}, entry, { source: entry.source || 'user', locked: false }), 0);
    var errors = validateEntry(normalized).filter(function (error) { return error !== 'entry.source is invalid'; });
    if (errors.length) return { ok: false, errors: errors };
    var index = state.knowledge.entries.findIndex(function (item) { return item.id === normalized.id; });
    if (index >= 0) state.knowledge.entries[index] = normalized;
    else state.knowledge.entries.push(normalized);
    state.knowledge.revision += 1;
    var whole = window.RPStateGuard.validate(state, window.RPTemplateData.stateSchema);
    if (!whole.ok) return whole;
    window.RPStorage.saveCanonical(state);
    window.RPEvents.emit('worldbook:local:changed', { id: normalized.id, revision: state.knowledge.revision });
    return { ok: true, entry: clone(normalized), revision: state.knowledge.revision };
  }

  function createLocal(entry) {
    var next = Object.assign({
      id: 'local-' + Date.now().toString(36), name: '新条目', content: '', enabled: true,
      locked: false, source: 'user', order: 100, placement: 'before_character', dependencies: []
    }, clone(entry || {}));
    return saveLocal(next);
  }

  function updateLocal(id, patch) {
    var current = localById(canonical(), id);
    if (!current) return { ok: false, errors: ['只有卡内本地条目可以直接编辑'] };
    return saveLocal(Object.assign({}, current, clone(patch || {}), { id: id, source: 'user', locked: false }));
  }

  function removeLocal(id) {
    var state = canonical();
    var index = state.knowledge.entries.findIndex(function (item) { return item.id === id; });
    if (index < 0) return { ok: false, errors: ['本地条目不存在'] };
    state.knowledge.entries.splice(index, 1);
    state.knowledge.revision += 1;
    window.RPStorage.saveCanonical(state);
    window.RPEvents.emit('worldbook:local:changed', { id: id, removed: true, revision: state.knowledge.revision });
    return { ok: true, revision: state.knowledge.revision };
  }

  window.RPWorldbookPatches = {
    entries: function () { return clone(canonical().knowledge.entries || []); },
    proposals: function () { return clone(canonical().knowledge.pendingProposals || []); },
    validateProposal: validateProposal,
    propose: propose,
    commit: commit,
    reject: reject
    ,createLocal: createLocal,
    updateLocal: updateLocal,
    removeLocal: removeLocal
  };
})();
