/**
 * config-loader
 *
 * Type-safe configuration loader supporting environment variables,
 * JSON files, and YAML files with schema validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported primitive types for config values. */
export type ConfigPrimitive = string | number | boolean;

/** A config value can be a primitive, an array, or a nested object. */
export type ConfigValue =
  | ConfigPrimitive
  | ConfigValue[]
  | { [key: string]: ConfigValue };

/** Raw configuration record. */
export type ConfigRecord = Record<string, ConfigValue>;

/** Supported source types. */
export type SourceType = 'env' | 'json' | 'yaml';

/** Describes a single configuration source. */
export interface ConfigSource {
  type: SourceType;
  /** File path (for json/yaml) or prefix (for env). */
  path?: string;
  /** Optional prefix to strip from env vars (e.g. "APP_"). */
  prefix?: string;
  /** Whether this source is required. Defaults to true. */
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Schema & Validation
// ---------------------------------------------------------------------------

/** Supported schema field types. */
export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/** Schema definition for a single config field. */
export interface SchemaField {
  type: SchemaFieldType;
  required?: boolean;
  default?: ConfigValue;
  description?: string;
  /** For string fields: regex pattern to match. */
  pattern?: string;
  /** For number fields: min/max bounds. */
  min?: number;
  max?: number;
  /** For array fields: expected item type. */
  items?: SchemaFieldType;
  /** For object fields: nested schema. */
  properties?: ConfigSchema;
}

/** Full config schema: mapping of dotted key paths to field definitions. */
export type ConfigSchema = Record<string, SchemaField>;

/** Validation error detail. */
export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

/** Result of schema validation. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepMerge(target: ConfigRecord, source: ConfigRecord): ConfigRecord {
  const result: ConfigRecord = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      typeof srcVal === 'object' &&
      srcVal !== null &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      tgtVal !== null &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as ConfigRecord,
        srcVal as ConfigRecord,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/** Convert a flat env-style map (APP_DB_HOST=x) into nested objects ({db:{host:x}}). */
function unflattenEnv(
  env: Record<string, string>,
  prefix: string,
): ConfigRecord {
  const result: ConfigRecord = {};
  const prefixUpper = prefix.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(prefixUpper)) continue;
    const stripped = key.slice(prefixUpper.length);
    const parts = stripped.toLowerCase().split('_');
    let current: ConfigRecord = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {} as ConfigRecord;
      }
      current = current[parts[i]] as ConfigRecord;
    }
    current[parts[parts.length - 1]] = coerceValue(value);
  }
  return result;
}

/** Try to coerce a string to number or boolean. */
function coerceValue(value: string): ConfigPrimitive {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  return value;
}

function typeOf(value: ConfigValue): SchemaFieldType {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Load config from environment variables. */
export function loadEnv(prefix: string = '', env?: Record<string, string>): ConfigRecord {
  const source = env ?? (process.env as Record<string, string>);
  if (!prefix) {
    const result: ConfigRecord = {};
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        result[key.toLowerCase()] = coerceValue(value);
      }
    }
    return result;
  }
  return unflattenEnv(source, prefix);
}

/** Load config from a JSON file. */
export function loadJson(filePath: string): ConfigRecord {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as ConfigRecord;
}

/** Load config from a YAML file. */
export function loadYaml(filePath: string): ConfigRecord {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const parsed = yaml.load(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`YAML file ${filePath} must contain a mapping at the top level`);
  }
  return parsed as ConfigRecord;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a config record against a schema. */
export function validate(
  config: ConfigRecord,
  schema: ConfigSchema,
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const [fieldPath, fieldDef] of Object.entries(schema)) {
    const value = getNestedValue(config, fieldPath);

    // Required check
    if (value === undefined) {
      if (fieldDef.required !== false) {
        errors.push({
          path: fieldPath,
          message: `Missing required field`,
          expected: fieldDef.type,
          received: 'undefined',
        });
      }
      continue;
    }

    // Type check
    const actualType = typeOf(value);
    if (actualType !== fieldDef.type) {
      errors.push({
        path: fieldPath,
        message: `Expected type "${fieldDef.type}", got "${actualType}"`,
        expected: fieldDef.type,
        received: actualType,
      });
      continue;
    }

    // String pattern check
    if (fieldDef.type === 'string' && fieldDef.pattern) {
      const regex = new RegExp(fieldDef.pattern);
      if (!regex.test(value as string)) {
        errors.push({
          path: fieldPath,
          message: `Value "${value}" does not match pattern /${fieldDef.pattern}/`,
          expected: fieldDef.pattern,
          received: String(value),
        });
      }
    }

    // Number bounds check
    if (fieldDef.type === 'number') {
      const num = value as number;
      if (fieldDef.min !== undefined && num < fieldDef.min) {
        errors.push({
          path: fieldPath,
          message: `Value ${num} is less than minimum ${fieldDef.min}`,
          expected: `>= ${fieldDef.min}`,
          received: String(num),
        });
      }
      if (fieldDef.max !== undefined && num > fieldDef.max) {
        errors.push({
          path: fieldPath,
          message: `Value ${num} is greater than maximum ${fieldDef.max}`,
          expected: `<= ${fieldDef.max}`,
          received: String(num),
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Retrieve a nested value by dotted path (e.g. "db.host"). */
function getNestedValue(obj: ConfigRecord, path: string): ConfigValue | undefined {
  const parts = path.split('.');
  let current: ConfigValue = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as ConfigRecord)[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/** Set a nested value by dotted path. */
function setNestedValue(obj: ConfigRecord, dotPath: string, value: ConfigValue): void {
  const parts = dotPath.split('.');
  let current: ConfigRecord = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as ConfigRecord;
  }
  current[parts[parts.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Apply Defaults
// ---------------------------------------------------------------------------

/** Apply default values from a schema to a config record (mutates & returns). */
export function applyDefaults(
  config: ConfigRecord,
  schema: ConfigSchema,
): ConfigRecord {
  for (const [fieldPath, fieldDef] of Object.entries(schema)) {
    if (fieldDef.default !== undefined) {
      const existing = getNestedValue(config, fieldPath);
      if (existing === undefined) {
        setNestedValue(config, fieldPath, fieldDef.default);
      }
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// ConfigLoader Class
// ---------------------------------------------------------------------------

export interface ConfigLoaderOptions {
  sources: ConfigSource[];
  schema?: ConfigSchema;
  /** If true, throw on validation errors. Defaults to true. */
  throwOnError?: boolean;
}

export class ConfigLoader<T extends ConfigRecord = ConfigRecord> {
  private readonly sources: ConfigSource[];
  private readonly schema?: ConfigSchema;
  private readonly throwOnError: boolean;
  private config: ConfigRecord = {};
  private loaded = false;

  constructor(options: ConfigLoaderOptions) {
    this.sources = options.sources;
    this.schema = options.schema;
    this.throwOnError = options.throwOnError ?? true;
  }

  /** Load all sources (in order, later sources override earlier). */
  load(): T {
    let merged: ConfigRecord = {};

    for (const source of this.sources) {
      try {
        const data = this.loadSource(source);
        merged = deepMerge(merged, data);
      } catch (err) {
        if (source.required !== false) {
          throw err;
        }
        // Non-required sources are silently skipped if they fail.
      }
    }

    // Apply defaults from schema
    if (this.schema) {
      applyDefaults(merged, this.schema);
    }

    // Validate
    if (this.schema) {
      const result = validate(merged, this.schema);
      if (!result.valid && this.throwOnError) {
        const messages = result.errors.map(
          (e) => `  [${e.path}] ${e.message}`,
        );
        throw new Error(
          `Configuration validation failed:\n${messages.join('\n')}`,
        );
      }
    }

    this.config = merged;
    this.loaded = true;
    return merged as T;
  }

  /** Get a value by dotted path. Throws if not loaded yet. */
  get<V extends ConfigValue = ConfigValue>(key: string): V | undefined {
    if (!this.loaded) {
      throw new Error('Config not loaded. Call .load() first.');
    }
    return getNestedValue(this.config, key) as V | undefined;
  }

  /** Get a value, throwing if it doesn't exist. */
  getOrThrow<V extends ConfigValue = ConfigValue>(key: string): V {
    const value = this.get<V>(key);
    if (value === undefined) {
      throw new Error(`Config key "${key}" not found`);
    }
    return value;
  }

  /** Return the full config object. */
  toObject(): T {
    if (!this.loaded) {
      throw new Error('Config not loaded. Call .load() first.');
    }
    return { ...this.config } as T;
  }

  private loadSource(source: ConfigSource): ConfigRecord {
    switch (source.type) {
      case 'env':
        return loadEnv(source.prefix ?? '');
      case 'json':
        if (!source.path) throw new Error('JSON source requires a path');
        return loadJson(source.path);
      case 'yaml':
        if (!source.path) throw new Error('YAML source requires a path');
        return loadYaml(source.path);
      default:
        throw new Error(`Unknown source type: ${source.type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/** Create and immediately load a config from the given sources. */
export function createConfig<T extends ConfigRecord = ConfigRecord>(
  options: ConfigLoaderOptions,
): T {
  const loader = new ConfigLoader<T>(options);
  return loader.load();
}
