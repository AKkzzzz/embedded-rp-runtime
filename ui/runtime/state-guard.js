(function () {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function typeOf(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    if (Number.isInteger(value)) return 'integer';
    return typeof value;
  }

  function validateNode(value, schema, path, errors, options) {
    if (!schema) return;
    var actual = typeOf(value);
    if (schema.type && actual !== schema.type && !(schema.type === 'number' && actual === 'integer')) {
      errors.push(path + ': expected ' + schema.type + ', got ' + actual);
      return;
    }
    if (schema.enum && schema.enum.indexOf(value) === -1) errors.push(path + ': value is outside enum');
    if (typeof value === 'number') {
      if (schema.minimum != null && value < schema.minimum) errors.push(path + ': below minimum');
      if (schema.maximum != null && value > schema.maximum) errors.push(path + ': above maximum');
    }
    if (typeof value === 'string') {
      if (schema.minLength != null && value.length < schema.minLength) errors.push(path + ': shorter than minLength');
      if (schema.maxLength != null && value.length > schema.maxLength) errors.push(path + ': longer than maxLength');
    }
    if (Array.isArray(value) && schema.items) {
      value.forEach(function (item, index) {
        validateNode(item, schema.items, path + '[' + index + ']', errors, options);
      });
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      var properties = schema.properties || {};
      (schema.required || []).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(path + '.' + key + ': required');
      });
      Object.keys(value).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          if (schema.additionalProperties === false) errors.push(path + '.' + key + ': unknown field');
          return;
        }
        validateNode(value[key], properties[key], path + '.' + key, errors, options);
      });
    }
  }

  function merge(target, patch, schema, path, errors) {
    Object.keys(patch || {}).forEach(function (key) {
      var childSchema = schema && schema.properties && schema.properties[key];
      var value = patch[key];
      var childPath = path + '.' + key;
      if (!childSchema && schema && schema.additionalProperties === false) {
        errors.push(childPath + ': unknown field');
        return;
      }
      if (childSchema && childSchema.readOnly) {
        errors.push(childPath + ': read-only');
        return;
      }
      if (Array.isArray(value)) {
        target[key] = clone(value);
        return;
      }
      if (value && typeof value === 'object') {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
        merge(target[key], value, childSchema || {}, childPath, errors);
        return;
      }
      target[key] = value;
    });
  }

  function applyPatch(current, patch, schema) {
    var next = clone(current);
    var errors = [];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, errors: ['$patch: must be an object'], value: current };
    }
    merge(next, patch, schema, '$', errors);
    validateNode(next, schema, '$', errors, {});
    return { ok: errors.length === 0, errors: errors, value: errors.length ? current : next };
  }

  function validate(value, schema) {
    var errors = [];
    validateNode(value, schema, '$', errors, {});
    return { ok: errors.length === 0, errors: errors };
  }

  window.RPStateGuard = {
    validate: validate,
    applyPatch: applyPatch
  };
})();
