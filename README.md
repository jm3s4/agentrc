# agent

[![CI](https://github.com/ekisa-team/agent/actions/workflows/ci.yaml/badge.svg)](https://github.com/ekisa-team/agent/actions/workflows/ci.yaml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Native ESM](https://img.shields.io/badge/Native-ESM-F7DF1E?logo=javascript&logoColor=black)](#requirements)

A modular TypeScript toolkit implementing the **Ekisa Specification for Agents (EAS)**. A declarative standard for defining, distributing, and executing AI agents with client-side tool ownership.

## Packages

| Package                                                         | JSR                                                                                                |
| :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| [`@ekisa/agent`](https://jsr.io/@ekisa/agent)                   | [![JSR](https://jsr.io/badges/@ekisa/agent)](https://jsr.io/badges/@ekisa/agent)                   |
| [`@ekisa/agent-artifact`](https://jsr.io/@ekisa/agent-artifact) | [![JSR](https://jsr.io/badges/@ekisa/agent-artifact)](https://jsr.io/badges/@ekisa/agent-artifact) |

## Requirements

- [Bun](https://bun.sh/)
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

The **Ekisa Specification for Agents** defines an autonomous agent as an isolated, self-contained directory governed by an `AGENT.md` file. It standardizes identity, procedural skills, tool contracts, and execution hints:

```text
my-agent/
├── AGENT.md                         # Canonical manifest (frontmatter + system prompt)
├── skills/
│   └── customer-support/
│       └── SKILL.md                 # Procedural domain workflows
└── tools/
    └── lookup-account.yaml          # Declarative HTTP/custom tool definitions
```

### Agent file example (`AGENT.md`)

```markdown
---
apiVersion: agent.ekisa.com.co/v1
kind: Agent

metadata:
    name: assistant
    version: 1.0.0
    displayName: "General assistant"
    description: Example AI agent demonstrating the Ekisa Specification.
    tags: [support, enterprise]
    suggestions:
        - type: prompt
          label: "Summarize"
          prompt: "Summarize the conversation so far."
        - type: group
          label: "Triage"
          items:
              - label: "Urgent?"
                prompt: "Is this request urgent?"
              - label: "Refund?"
                prompt: "Is this a refund request?"

spec:
    # If omitted, defaults to { language: en-US, timeZone: UTC }.
    locale:
        language: es-CO
        timeZone: America/Bogota

    model:
        id: openrouter/deepseek/deepseek-v4.1-flash
        temperature: 0
        reasoningEffort: low
        maxTokens: 2048

    # If omitted, defaults to { maxSteps: 6, timeoutMs: 60000 }.
    runtime:
        maxSteps: 6
        timeoutMs: 60000

    capabilities:
        knowledge:
            sources:
                - institutional-kb

    skills:
        - ./skills/customer-support

    tools:
        - ./tools/lookup-account.yaml
---

You are a general-purpose assistant for enterprise support. Answer concisely and accurately; ask for clarification when the user's intent is ambiguous.
```

> [!IMPORTANT]
> Strings in `spec.tools` are paths inside the artifact root (e.g. `./tools/lookup-account.yaml`). They're resolved by `@ekisa/agent-artifact` when the artifact is loaded; the parsing layer never reads files directly. Inline tool definitions are also accepted for tools that are not backed by a file in the artifact.

> [!TIP]
> `spec.model` and `metadata` are extensible: both accept provider-specific and organization-specific fields that are not declared in the schema. Use them to carry model parameters (`responseFormat`, `cacheControl`, ...) or metadata (`owner`, `contact`, ...) without waiting for a schema bump.

### Tool definition example (`tools/lookup-account.yaml`)

```yaml
name: lookup-account
displayName: "Account lookup"
description: Looks up account details by customer email address.
inputSchema:
    type: object
    properties:
        email:
            type: string
            format: email
    required: [email]
outputSchema:
    type: object
    properties:
        accountId:
            type: string
        status:
            type: string
execution:
    type: http
    method: GET
    url: "https://internal.example.com/accounts?email={{email}}"
    headers:
        Accept: application/json
        Authorization: "Bearer {{secret.INTERNAL_API_KEY}}"
    timeoutMs: 10000
```

## Template expressions

Tool definitions may reference values at call time using `{{...}}` expressions. Two namespaces exist, and both are valid in `execution.url`, in each `execution.headers` value, and in `execution.body` when given as a string.

| Placeholder       | Resolved from                                    | Example                                               |
| :---------------- | :----------------------------------------------- | :---------------------------------------------------- |
| `{{name}}`        | Tool argument `name` (declared in `inputSchema`) | `?email={{email}}`                                    |
| `{{secret.NAME}}` | Runtime secret provider                          | `Authorization: "Bearer {{secret.INTERNAL_API_KEY}}"` |

Rules the runtime follows:

- A `{{name}}` referencing a parameter that was not declared in `inputSchema` fail loudly at call time. Silent empty substitution is not permitted.
- A `{{secret.NAME}}` that the runtime's secret provider can't resolve fails loudly at call time. Substitution happens before the request is dispatched; the resolved value is never persisted to disk, logs, or error messages.

The template language, including the exact character set permitted for `name` and `NAME` is defined in the EAS specification and enforced by the runtime, not by the manifest schema. Manifests that contain literal `{{` sequences in header or body values should be interpreted as intentional only if they also resolve at runtime; otherwise they're malformed.

> [!IMPORTANT]
> Never write a credential as a literal. Any value in a tool file becomes part of the published artifact. Sensitive headers must use the `{{secret.NAME}}` namespace:
>
> ```yaml
> # Correct: resolved by the runtime, never shipped in the artifact.
> Authorization: "Bearer {{secret.INTERNAL_API_KEY}}"
>
> # Wrong: the credential is now baked into the artifact forever.
> Authorization: "Bearer sk-live-abc123…"
> ```
