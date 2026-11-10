# agent

[![CI](https://github.com/ekisa-team/agent/actions/workflows/ci.yaml/badge.svg)](https://github.com/ekisa-team/agent/actions/workflows/ci.yaml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Native ESM](https://img.shields.io/badge/Native-ESM-F7DF1E?logo=javascript&logoColor=black)](#requirements)

A modular TypeScript toolkit implementing the **Ekisa Specification for Agents (EAS)**. A declarative standard for defining, distributing via OCI, and executing AI agents with client side tool ownership.

## Packages

| Package                                                       | JSR                                                                                       |
| :------------------------------------------------------------ | :---------------------------------------------------------------------------------------- |
| [`@ekisa/agent-spec`](https://jsr.io/@ekisa/agent-spec)       | [![JSR](https://jsr.io/badges/@ekisa/agent-spec)](https://jsr.io/@ekisa/agent-spec)       |
| [`@ekisa/agent-skills`](https://jsr.io/@ekisa/agent-skills)   | [![JSR](https://jsr.io/badges/@ekisa/agent-skills)](https://jsr.io/@ekisa/agent-skills)   |
| [`@ekisa/agent-oci`](https://jsr.io/@ekisa/agent-oci)         | [![JSR](https://jsr.io/badges/@ekisa/agent-oci)](https://jsr.io/@ekisa/agent-oci)         |
| [`@ekisa/agent-runtime`](https://jsr.io/@ekisa/agent-runtime) | [![JSR](https://jsr.io/badges/@ekisa/agent-runtime)](https://jsr.io/@ekisa/agent-runtime) |

## Requirements

- [Bun](https://bun.sh/) (v1.1+ with workspace support)
- TypeScript (v7.0+) with native ESM

No bundler, transpilation, or build step is required. Packages are published directly as raw TypeScript to [JSR](https://jsr.io/).

## Development

### Install dependencies

```bash
bun install
```

### Run typechecks, linter and tests

```bash
bun run check
bun run lint
bun run test
```

## The Ekisa Specification for Agents (EAS)

The **Ekisa Specification for Agents** defines an autonomous agent as an isolated, self contained directory governed by an `agent.yaml` manifest. It standardizes identity, procedural skills, tool contracts, and execution hints:

```text
my-agent/
├── agent.yaml                       # Canonical manifest
├── instructions/
│   └── system.md                    # Core persona & guardrails
├── skills/
│   └── customer-support/
│       └── SKILL.md                 # Procedural domain workflows
└── tools/
    └── lookup-account.yaml          # Declarative HTTP/custom tool contracts
```

### Manifest example (`agent.yaml`)

```yaml
apiVersion: agent.ekisa.com.co/v1
kind: Agent

metadata:
    name: assistant
    version: 1.0.0
    displayName: "General assistant"
    description: Example AI agent demonstrating the Ekisa Specification.
    tags: [support, enterprise]

spec:
    locale:
        language: es-CO
        timezone: America/Bogota

    # Instructions support either a relative file path or inline markdown text
    instructions:
        file: ./instructions/system.md
        # inline: |
        #   Eres un asistente útil y conciso...

    model:
        suggested: openrouter/deepseek/deepseek-v4.1-flash
        temperature: 0
        reasoningEffort: low
        maxTokens: 2048

    runtime:
        maxSteps: 6
        timeoutMs: 60000

    capabilities:
        knowledge:
            enabled: true
            sources:
                - institutional-kb
        webSearch:
            enabled: false
            maxResults: 5
        computerUse:
            enabled: false
        codeInterpreter:
            enabled: false

    skills:
        - ./skills/customer-support

    tools:
        - ./tools/lookup-account.yaml
```

> [!NOTE]
> Only `knowledge` is resolved by `@ekisa/agent-runtime`. The `webSearch`, `computerUse`, and `codeInterpreter` blocks are schema validated by `@ekisa/agent-spec` but resolve to no-op in the default runtime, regardless of `enabled`. They are reserved for upcoming platform releases.

## Client side tool execution

Under the Ekisa specification, tool execution lives on the consumer application, not on a central proxy. Tool manifests declare contracts (parameters and HTTP templates), while consumer apps inject credentials locally at runtime:

```typescript
import { pullAgent } from "@ekisa/agent-oci";
import { createRuntime, httpTool } from "@ekisa/agent-runtime";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Pull immutable bundle from an OCI registry
const bundle = await pullAgent("ghcr.io/ekisa/agents/assistant:1.0.0");

// Compile declarative tools locally with private secrets
const tools = {
    lookup_account: httpTool(bundle.manifest.spec.tools[0], {
        headers: { Authorization: `Bearer ${process.env.INTERNAL_API_KEY}` },
    }),
};

// Start execution runtime
const runtime = createRuntime({
    bundle,
    model: myProvider(bundle.manifest.spec.model.suggested),
    tools,
});

// Stream responses
const stream = await runtime.stream(messages);
```
