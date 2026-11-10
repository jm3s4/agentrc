# agents

A modular TypeScript toolkit for defining, distributing, and executing AI agents.

## Packages

| Package                                                       | JSR                                                |
| :------------------------------------------------------------ | :------------------------------------------------- |
| [`@ekisa/agent-spec`](https://jsr.io/@ekisa/agent-spec)       | ![JSR](https://jsr.io/badges/@ekisa/agent-spec)    |
| [`@ekisa/agent-skills`](https://jsr.io/@ekisa/agent-skills)   | ![JSR](https://jsr.io/badges/@ekisa/agent-skills)  |
| [`@ekisa/agent-oci`](https://jsr.io/@ekisa/agent-oci)         | ![JSR](https://jsr.io/badges/@ekisa/agent-oci)     |
| [`@ekisa/agent-runtime`](https://jsr.io/@ekisa/agent-runtime) | ![JSR](https://jsr.io/badges/@ekisa/agent-runtime) |

## Requirements

- [Bun](https://bun.sh/) with workspace support.
- [JSR](https://jsr.io/) account for publishing.
- TypeScript with native ESM support.

No bundler or compilation step is required. JSR publishes raw TypeScript.

## Development

### 1. Install dependencies

```bash
bun install
```

### 2. Run tests

```bash
bun test
```

Run tests across all workspace packages from the repository root.

### 3. Define an agent

Agents are described using an `agent.yaml` manifest:

```yaml
apiVersion: agent.ekisa.com.co/v1
kind: Agent

metadata:
    name: example-agent
    version: 1.0.0
    description: Example AI agent

spec:
    instructions:
        file: ./instructions/system.md

    locale:
        language: en
        timezone: UTC

    skills: []

    tools: []

    model:
        suggestedModel: deepseek/
        temperature: 0

    runtime:
        maxToolIterations: 6
        timeoutMs: 60000
```

Use `@ekisa/agent-spec` to parse, validate, and define manifests programmatically.

## Distribution

In principle, agents are distributed as versioned OCI artifacts through registries such as GHCR, Harbor, and Docker Hub.

```typescript
import { pullAgent } from "@ekisa/agent-oci";

const agent = await pullAgent("ghcr.io/ekisa/agents/example:1.0.0");
```

The OCI client verifies artifact digests and extracts the agent bundle into memory.

## Publishing

Publish each package independently from its directory. For example:

```bash
cd packages/agent-spec
bunx jsr publish
```
