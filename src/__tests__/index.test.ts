import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadEnv,
  loadJson,
  loadYaml,
  validate,
  applyDefaults,
  ConfigLoader,
  createConfig,
  ConfigSchema,
  ConfigRecord,
} from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-loader-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

// ---------------------------------------------------------------------------
// loadEnv
// ---------------------------------------------------------------------------

describe('loadEnv', () => {
  it('loads flat env vars with no prefix', () => {
    const env = { FOO: 'bar', BAZ: '42' };
    const cfg = loadEnv('', env);
    expect(cfg['foo']).toBe('bar');
    expect(cfg['baz']).toBe(42);
  });

  it('loads env vars with prefix and nests by underscore', () => {
    const env = {
      APP_DB_HOST: 'localhost',
      APP_DB_PORT: '5432',
      APP_DEBUG: 'true',
      UNRELATED: 'skip',
    };
    const cfg = loadEnv('APP_', env);
    expect(cfg).toEqual({
      db: { host: 'localhost', port: 5432 },
      debug: true,
    });
  });

  it('coerces boolean strings', () => {
    const env = { APP_VERBOSE: 'false' };
    const cfg = loadEnv('APP_', env);
    expect(cfg['verbose']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadJson
// ---------------------------------------------------------------------------

describe('loadJson', () => {
  it('loads a JSON config file', () => {
    const file = tmpFile('config.json', JSON.stringify({ port: 3000, host: '0.0.0.0' }));
    const cfg = loadJson(file);
    expect(cfg['port']).toBe(3000);
    expect(cfg['host']).toBe('0.0.0.0');
  });

  it('throws on invalid JSON', () => {
    const file = tmpFile('bad.json', '{ broken }');
    expect(() => loadJson(file)).toThrow();
  });

  it('throws on missing file', () => {
    expect(() => loadJson('/nonexistent/path.json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadYaml
// ---------------------------------------------------------------------------

describe('loadYaml', () => {
  it('loads a YAML config file', () => {
    const yamlContent = `
server:
  host: localhost
  port: 8080
debug: true
`;
    const file = tmpFile('config.yaml', yamlContent);
    const cfg = loadYaml(file);
    expect(cfg).toEqual({
      server: { host: 'localhost', port: 8080 },
      debug: true,
    });
  });

  it('throws on non-mapping YAML', () => {
    const file = tmpFile('list.yaml', '- one\n- two\n');
    expect(() => loadYaml(file)).toThrow(/mapping/);
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('validate', () => {
  const schema: ConfigSchema = {
    'server.host': { type: 'string', required: true },
    'server.port': { type: 'number', required: true, min: 1, max: 65535 },
    'debug': { type: 'boolean', required: false },
    'name': { type: 'string', pattern: '^[a-z]+$' },
  };

  it('passes for valid config', () => {
    const config: ConfigRecord = {
      server: { host: 'localhost', port: 8080 },
      debug: true,
      name: 'myapp',
    };
    const result = validate(config, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails for missing required fields', () => {
    const config: ConfigRecord = { debug: false };
    const result = validate(config, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'server.host')).toBe(true);
    expect(result.errors.some((e) => e.path === 'server.port')).toBe(true);
  });

  it('fails for wrong type', () => {
    const config: ConfigRecord = {
      server: { host: 123 as unknown as string, port: 8080 },
      name: 'myapp',
    };
    const result = validate(config, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('server.host');
  });

  it('fails for number out of bounds', () => {
    const config: ConfigRecord = {
      server: { host: 'localhost', port: 99999 },
      name: 'myapp',
    };
    const result = validate(config, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('maximum');
  });

  it('fails for pattern mismatch', () => {
    const config: ConfigRecord = {
      server: { host: 'localhost', port: 8080 },
      name: 'INVALID',
    };
    const result = validate(config, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('name');
  });

  it('allows missing optional fields', () => {
    const config: ConfigRecord = {
      server: { host: 'localhost', port: 8080 },
      name: 'myapp',
    };
    const result = validate(config, schema);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyDefaults
// ---------------------------------------------------------------------------

describe('applyDefaults', () => {
  it('fills in defaults for missing fields', () => {
    const schema: ConfigSchema = {
      port: { type: 'number', default: 3000 },
      host: { type: 'string', default: 'localhost' },
    };
    const config: ConfigRecord = {};
    applyDefaults(config, schema);
    expect(config['port']).toBe(3000);
    expect(config['host']).toBe('localhost');
  });

  it('does not overwrite existing values', () => {
    const schema: ConfigSchema = {
      port: { type: 'number', default: 3000 },
    };
    const config: ConfigRecord = { port: 9090 };
    applyDefaults(config, schema);
    expect(config['port']).toBe(9090);
  });

  it('fills nested defaults', () => {
    const schema: ConfigSchema = {
      'db.host': { type: 'string', default: 'localhost' },
      'db.port': { type: 'number', default: 5432 },
    };
    const config: ConfigRecord = {};
    applyDefaults(config, schema);
    expect(config).toEqual({ db: { host: 'localhost', port: 5432 } });
  });
});

// ---------------------------------------------------------------------------
// ConfigLoader
// ---------------------------------------------------------------------------

describe('ConfigLoader', () => {
  it('loads from a single JSON source', () => {
    const file = tmpFile('app.json', JSON.stringify({ port: 4000, name: 'test' }));
    const loader = new ConfigLoader({
      sources: [{ type: 'json', path: file }],
    });
    const cfg = loader.load();
    expect(cfg['port']).toBe(4000);
  });

  it('merges multiple sources with later overriding earlier', () => {
    const json1 = tmpFile('base.json', JSON.stringify({ port: 3000, host: 'base' }));
    const json2 = tmpFile('override.json', JSON.stringify({ port: 9090 }));
    const loader = new ConfigLoader({
      sources: [
        { type: 'json', path: json1 },
        { type: 'json', path: json2 },
      ],
    });
    const cfg = loader.load();
    expect(cfg['port']).toBe(9090);
    expect(cfg['host']).toBe('base');
  });

  it('throws on validation failure when throwOnError is true', () => {
    const file = tmpFile('bad.json', JSON.stringify({ port: 'not-a-number' }));
    const loader = new ConfigLoader({
      sources: [{ type: 'json', path: file }],
      schema: { port: { type: 'number', required: true } },
      throwOnError: true,
    });
    expect(() => loader.load()).toThrow(/validation failed/);
  });

  it('skips non-required sources that fail to load', () => {
    const good = tmpFile('good.json', JSON.stringify({ name: 'ok' }));
    const loader = new ConfigLoader({
      sources: [
        { type: 'json', path: '/does/not/exist.json', required: false },
        { type: 'json', path: good },
      ],
    });
    const cfg = loader.load();
    expect(cfg['name']).toBe('ok');
  });

  it('get() retrieves nested values by dotted path', () => {
    const file = tmpFile('nested.json', JSON.stringify({ db: { host: 'pg', port: 5432 } }));
    const loader = new ConfigLoader({
      sources: [{ type: 'json', path: file }],
    });
    loader.load();
    expect(loader.get('db.host')).toBe('pg');
    expect(loader.get('db.port')).toBe(5432);
  });

  it('getOrThrow() throws for missing keys', () => {
    const file = tmpFile('min.json', JSON.stringify({ a: 1 }));
    const loader = new ConfigLoader({
      sources: [{ type: 'json', path: file }],
    });
    loader.load();
    expect(() => loader.getOrThrow('missing')).toThrow(/not found/);
  });

  it('throws if get() called before load()', () => {
    const loader = new ConfigLoader({ sources: [] });
    expect(() => loader.get('key')).toThrow(/not loaded/);
  });

  it('applies schema defaults during load', () => {
    const file = tmpFile('partial.json', JSON.stringify({ name: 'app' }));
    const loader = new ConfigLoader({
      sources: [{ type: 'json', path: file }],
      schema: {
        name: { type: 'string', required: true },
        port: { type: 'number', required: false, default: 3000 },
      },
    });
    const cfg = loader.load();
    expect(cfg['port']).toBe(3000);
    expect(cfg['name']).toBe('app');
  });
});

// ---------------------------------------------------------------------------
// createConfig (convenience)
// ---------------------------------------------------------------------------

describe('createConfig', () => {
  it('creates and loads config in one call', () => {
    const file = tmpFile('quick.json', JSON.stringify({ fast: true }));
    const cfg = createConfig({ sources: [{ type: 'json', path: file }] });
    expect(cfg['fast']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

describe('deep merge via multiple sources', () => {
  it('merges nested objects without clobbering siblings', () => {
    const f1 = tmpFile('a.json', JSON.stringify({ db: { host: 'a', port: 1 } }));
    const f2 = tmpFile('b.json', JSON.stringify({ db: { port: 2 } }));
    const cfg = createConfig({
      sources: [
        { type: 'json', path: f1 },
        { type: 'json', path: f2 },
      ],
    });
    expect(cfg['db']).toEqual({ host: 'a', port: 2 });
  });
});
