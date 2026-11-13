# agent

[![CI](https://github.com/jm3s4/agent/actions/workflows/ci.yaml/badge.svg)](https://github.com/jm3s4/agent/actions/workflows/ci.yaml)
[![JSR](https://jsr.io/badges/@jm3s4/agentrc)](https://jsr.io/@jm3s4/agentrc)

A small TypeScript library for parsing, validating, and loading agent definitions (`AGENT.md`), skills (`SKILL.md`), and declarative HTTP tools.

Inference and tool loops stay in the consuming application. `@jm3s4/agentrc` provides `Agent`, `Tool`, `Skill`, and a `FileSystem` interface so definitions can load from Markdown files, in memory maps, or SQL rows.

## Installation

```sh
# pnpm
pnpm dlx jsr add @jm3s4/agentrc

# npm
npx jsr add @jm3s4/agentrc

# bun
bunx jsr add @jm3s4/agentrc

# deno
deno add jsr:@jm3s4/agentrc
```

`@jm3s4/agentrc` uses Web APIs only. Local filesystem helpers live in `@jm3s4/agentrc/node`.

## 1. Agents

An `AGENT.md` document has YAML frontmatter for configuration and a Markdown body for system instructions.

```ts
import { Agent } from "@jm3s4/agentrc";

const agent = new Agent(`---
name: support-bot
version: 1.0.0
locale:
  language: es-CO
  timeZone: America/Bogota
model:
  id: gpt-4o
  temperature: 0.2
---
You are a helpful customer support assistant.
`);

console.log(agent.name); // "support-bot"
console.log(agent.model.id); // "gpt-4o"

const instructions = agent.buildInstructions();
console.log(instructions.toString());
```

`new Agent(...)` validates the manifest with Valibot and any inline tool JSON Schemas with Ajv, throwing `ParseError` or `ValidationError` on invalid input.

An `Agent` can also be constructed from plain objects and round trips with `agent.toJSON()` and `agent.toString()`:

```ts
const agent = new Agent({
    name: "support-bot",
    version: "1.0.0",
    model: { id: "gpt-4o" },
    instructions: "You are a concise customer support assistant.",
});

const copy = new Agent(agent.toJSON());
const markdown = agent.toString();
```

> `model` accepts unrecognized properties, and `metadata` holds arbitrary key/value pairs. Other manifest objects reject unknown keys.

## 2. System instructions

`agent.buildInstructions()` separates stable instructions from dynamic runtime context:

```ts
const built = agent.buildInstructions({
    variables: { tenantId: "clinic-12", channel: "web" },
    additionalInstructions: "Keep answers under 3 sentences.",
});

built.staticInstructions; // Agent body and <available_skills> catalog
built.dynamicInstructions; // Sorted runtime variables, localized date, and extra instructions
built.toString(); // staticInstructions + dynamicInstructions joined
```

## 3. Tools

`Tool` wraps a validated `inputSchema` (checked with Ajv before execution) with either a TypeScript handler or a declarative HTTP request.

### TypeScript handlers

```ts
import { Tool } from "@jm3s4/agentrc";

const weather = new Tool(
    {
        name: "get-weather",
        description: "Get the current weather for a city.",
        inputSchema: {
            type: "object",
            required: ["city"],
            properties: {
                city: { type: "string" },
            },
        },
    },
    {
        handler: async ({ city }) => ({ city, tempC: 18, condition: "cloudy" }),
    },
);

const output = await weather.execute({ city: "Bogota" });
```

### HTTP tools

`Tool` also executes declarative REST definitions. `{{param}}` interpolates arguments (URL encoded in `url`, unencoded in `headers` and `body`), and `{{secret.NAME}}` resolves secrets supplied at runtime.

```ts
import { Tool } from "@jm3s4/agentrc";

const lookupAccount = new Tool(
    `
name: lookup-account
description: Looks up customer account status by email address.
inputSchema:
  type: object
  required: [email]
  properties:
    email:
      type: string
      format: email
execution:
  type: http
  method: GET
  url: https://api.example.com/accounts?email={{email}}
  headers:
    Authorization: Bearer {{secret.API_KEY}}
  timeoutMs: 5000
`,
    {
        secrets: { API_KEY: process.env.API_KEY! },
        security: { allowedHosts: ["api.example.com"] },
    },
);

const account = await lookupAccount.execute({ email: "ada@example.com" });
```

`.configure()` returns a new `Tool` (and `agent.configure()` returns a new `Agent`) with bound secrets, SSRF rules, or a custom `fetch` implementation without mutating the original instance.

HTTP execution rejects protocols other than HTTP and HTTPS, disables redirects (`redirect: 'error'`), and blocks loopback, private subnets, cloud metadata (`169.254/16`, `fe80::/10`), CGNAT, and reserved IP ranges via `ipaddr.js`. Loopback and private ranges can be enabled with `allowLoopback: true` or `allowPrivateIps: true`.

> URL checks inspect the literal hostname before DNS resolution. Custom DNS pinning or egress proxies can be wired through `.configure({ fetch })`.

## 4. Skills

`Skill` implements `SKILL.md` frontmatter validation, XML catalog formatting, and lazy resource reads.

```ts
import { MemoryFileSystem, Skill } from "@jm3s4/agentrc";

const files = new MemoryFileSystem({
    "SKILL.md": `---
name: triage
description: Classify incoming support tickets by urgency.
---
Always check billing outages before routing to tier 1 support.
`,
    "references/matrix.md": "# Priority Matrix\nP1: Service down",
});

const skill = await Skill.load(files);
const resources = await skill.listResources();
const matrix = await skill.getResource("references/matrix.md");

console.log(skill.name); // "triage"
console.log(resources[0]?.path); // "references/matrix.md"
console.log(await matrix.text()); // "# Priority Matrix\nP1: Service down"
```

Paths containing `..`, leading slashes, or drive letters are rejected with `ParseError` before calling `files.read()`.

## 5. Loading bundles

When `AGENT.md` references standalone tool files and skill directories:

```text
support-bot/
├── AGENT.md
├── tools/
│   └── lookup-account.yaml
└── skills/
    └── triage/
        ├── SKILL.md
        └── references/
            └── matrix.md
```

`Agent.load(files)` and `Skill.load(files)` read from any `FileSystem` implementing `{ read, list }`.

### Local disk (`@jm3s4/agentrc/node`)

```ts
import { Agent, Skill } from "@jm3s4/agentrc";
import { NodeFileSystem } from "@jm3s4/agentrc/node";

const agent = await Agent.load(new NodeFileSystem("./agents/support-bot"), {
    secrets: { API_KEY: process.env.API_KEY! },
    security: { allowedHosts: ["api.example.com"] },
});

const built = agent.buildInstructions(); // Includes agent.skills catalog
const toolResult = await agent.getTool("lookup-account")?.execute({ email: "ada@example.com" });

const summaries = await Skill.discover(new NodeFileSystem("./skills"));
```

`NodeFileSystem` checks `realpath` on reads and listings to block symlink escapes outside the root directory.

### In memory (`MemoryFileSystem`)

```ts
import { Agent, MemoryFileSystem } from "@jm3s4/agentrc";

const files = new MemoryFileSystem({
    "AGENT.md": agentMd,
    "tools/lookup-account.yaml": toolYaml,
    "skills/triage/SKILL.md": skillMd,
    "skills/triage/references/matrix.md": "# Matrix",
});

const agent = await Agent.load(files);
const requestAgent = agent.configure({ secrets: tenantSecrets });
```

### SQL and object storage

`Agent`, `Tool`, and `Skill` can be constructed from SQL rows together with a `{ read, list }` `FileSystem` object:

```ts
import { Agent, type FileSystem, Skill, Tool } from "@jm3s4/agentrc";

function createSkillFiles(skillId: string): FileSystem {
    return {
        read: (path) => bucket.getObject(`skills/${skillId}/${path}`),
        list: async (prefix = "") => {
            const pattern = prefix ? `${prefix}/%` : "%";
            const rows = await sql<{ path: string }[]>`
                select path
                from skill_files
                where skill_id = ${skillId}
                  and path like ${pattern}
            `;
            return rows.map((row) => row.path);
        },
    };
}

const agentRow = await sql.one`
    select id, manifest, instructions
    from agents
    where slug = ${slug} and tenant_id = ${tenantId}
`;

const toolRows = await sql`
    select definition
    from tools
    where agent_id = ${agentRow.id}
`;

const skillRows = await sql`
    select id, name, description, instructions, metadata
    from skills
    where agent_id = ${agentRow.id}
`;

const agent = new Agent(
    { ...agentRow.manifest, instructions: agentRow.instructions },
    {
        tools: toolRows.map((row) => new Tool(row.definition)),
        skills: skillRows.map(
            (row) =>
                new Skill(
                    {
                        name: row.name,
                        description: row.description,
                        instructions: row.instructions,
                        metadata: row.metadata,
                    },
                    { files: createSkillFiles(row.id) },
                ),
        ),
        secrets: tenantSecrets,
        security: { allowedHosts: ["api.example.com"] },
    },
);
```

## 6. AI SDK integration

Wiring an `Agent` into Vercel AI SDK (`ToolLoopAgent`):

```ts
import { HttpError, ParseError, ValidationError } from "@jm3s4/agentrc";
import { dynamicTool, isStepCount, jsonSchema, ToolLoopAgent } from "ai";

const built = agent.buildInstructions({
    variables: { tenantId: "clinic-12" },
});

const tools = Object.fromEntries(
    agent.tools.map((t) => [
        t.name,
        dynamicTool({
            description: t.description,
            inputSchema: jsonSchema(t.inputSchema),
            execute: async (input, { abortSignal }) => {
                try {
                    return await t.execute(input as Record<string, unknown>, { signal: abortSignal });
                } catch (error) {
                    if (error instanceof HttpError) {
                        return { isError: true, status: error.status, message: error.message };
                    }
                    if (error instanceof ValidationError || error instanceof ParseError) {
                        return { isError: true, message: error.message };
                    }
                    throw error;
                }
            },
        }),
    ]),
);

const runner = new ToolLoopAgent({
    model: provider(agent.model.id),
    instructions: built.toString(),
    tools,
    stopWhen: isStepCount(agent.runtime.maxSteps),
});
```

## Errors

- **`ParseError`**: malformed frontmatter, YAML, or JSON, missing template arguments or secrets, SSRF rejections, missing files, or path traversal.
- **`ValidationError`**: schema failures on manifests, skills, tools, or `Tool.execute()` arguments, with `.issues` (`readonly { path: string; message: string }[]`).
- **`HttpError`**: transport failures (`status: 502`), timeouts (`status: 504`), or error responses (`status: response.status`) from HTTP tools.

## Contributing

Requires Node.js 26+ and pnpm.

```sh
pnpm install
pnpm check       # typecheck, lint, format check, tests, and node import check
```

Individual scripts:

```sh
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint --type-aware .
pnpm fmt         # format with oxfmt
pnpm test        # vitest run
pnpm nodecheck   # verify no node:* imports exist outside lib/node/
```

`node:*` imports are restricted to `lib/node/` and verified in CI by `pnpm nodecheck`.

## License

[MIT](LICENSE)
