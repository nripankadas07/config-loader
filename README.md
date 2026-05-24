# config-loader


Type-safe configuration loader for Node.js applications. Load config from environment variables, JSON files, and YAML files with schema validation, defaults, and deep merging.

## Features

- **Multi-source loading** â env vars, JSON files, YAML files
- **Deep merge** â later sources override earlier ones at any nesting depth
- **Schema validation** â type checks, required fields, patterns, numeric bounds
- **Default values** â define fallbacks in the schema, applied automatically
- **Env prefix support** â strip and nest env vars (e.g. `APP_DB_HOST` â `db.host`)
- **Type coercion** â env strings auto-coerced to numbers and booleans
- **Dotted path access** â retrieve nested values with `get('db.host')`

## Installation

```bash
npm install && npm run build
```

## Quick Start

```typescript
import { ConfigLoader } from 'config-loader';

const loader = new ConfigLoader({
  sources: [
    { type: 'yaml', path: './config/defaults.yaml' },
    { type: 'json', path: './config/local.json', required: false },
    { type: 'env', prefix: 'APP_' },
  ],
  schema: {
    'server.host': { type: 'string', required: true, default: 'localhost' },
    'server.port': { type: 'number', required: true, min: 1, max: 65535, default: 3000 },
    'debug': { type: 'boolean', required: false, default: false },
  },
});

const config = loader.load();

console.log(loader.get('server.host')); // 'localhost'
console.log(loader.get('server.port')); // 3000
```

## Usage

### Loading from Environment Variables

```typescript
import { loadEnv } from 'config-loader';

// With prefix: APP_DB_HOST=pg APP_DB_PORT=5432
const config = loadEnv('APP_');
// â { db: { host: 'pg', port: 5432 } }
```

### Loading from JSON

```typescript
import { loadJson } from 'config-loader';

const config = loadJson('./config.json');
```

### Loading from YAML

```typescript
import { loadYaml } from 'config-loader';

const config = loadYaml('./config.yaml');
```

### Schema Validation

```typescript
import { validate, ConfigSchema, ConfigRecord } from 'config-loader';

const schema: ConfigSchema = {
  'server.host': { type: 'string', required: true },
  'server.port': { type: 'number', min: 1, max: 65535 },
  'name': { type: 'string', pattern: '^[a-z-]+$' },
};

const result = validate(config, schema);
if (!result.valid) {
  console.error(result.errors);
}
```

### Using the Convenience Factory

```typescript
import { createConfig } from 'config-loader';

const config = createConfig({
  sources: [{ type: 'json', path: './config.json' }],
  schema: { port: { type: 'number', default: 3000 } },
});
```

## API Reference

### `ConfigLoader`

| Method | Description |
|--------|-------------|
| `load()` | Load and merge all sources, apply defaults, validate |
| `get(key)` | Get a value by dotted path |
| `getOrThrow(key)` | Get a value or throw if missing |
| `toObject()` | Return the full config as a plain object |

### `ConfigSource`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'env' \| 'json' \| 'yaml'` | Source type |
| `path` | `string` | File path (json/yaml) |
| `prefix` | `string` | Env var prefix to match and strip |
| `required` | `boolean` | Whether failure to load throws (default: true) |

### `SchemaField`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'string' \| 'number' \| 'boolean' \| 'array' \| 'object'` | Expected type |
| `required` | `boolean` | Whether the field must be present (default: true) |
| `default` | `ConfigValue` | Fallback value if missing |
| `pattern` | `string` | Regex pattern for strings |
| `min` / `max` | `number` | Bounds for numbers |

## Architecture

```
ââââââââââââââââ   ââââââââââââââââ   ââââââââââââââââ
â   Env Vars   â   â  JSON File   â   â  YAML File   â
ââââââââ¬ââââââââ   ââââââââ¬ââââââââ   ââââââââ¬ââââââââ
       â                  â                   â
       ââââââââââââ¬ââââââââ´ââââââââââââââââââââ
                  â  Deep Merge (ordered)
                  â¼
           ââââââââââââââââ
           â  Apply Defs  â
           ââââââââ¬ââââââââ
                  â¼
           ââââââââââââââââ
           â   Validate   â
           ââââââââ¬ââââââââ
                  â¼
           ââââââââââââââââ
           â  ConfigRecordâ
           ââââââââââââââââ
```

## License

MIT Â© Nripanka Das
