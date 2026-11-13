# agentrc

[![CI](https://github.com/jm3s4/agentrc/actions/workflows/ci.yaml/badge.svg)](https://github.com/jm3s4/agentrc/actions/workflows/ci.yaml)
[![CI](https://github.com/jm3s4/agentrc/actions/workflows/release.yaml/badge.svg)](https://github.com/jm3s4/agentrc/actions/workflows/release.yaml)
[![JSR](https://jsr.io/badges/@jm3s4/agentrc)](https://jsr.io/@jm3s4/agentrc)

TypeScript library for parsing, validating, and loading agent definitions (`AGENT.md`), skills (`SKILL.md`), and declarative tools.

`@jm3s4/agentrc` uses Web APIs only. Local disk helpers live in `@jm3s4/agentrc/node`.

## Installation

```sh
pnpm dlx jsr add @jm3s4/agentrc
# or: npx jsr add @jm3s4/agentrc | bunx jsr add @jm3s4/agentrc | deno add jsr:@jm3s4/agentrc
```

## Agents

An `Agent` parses `AGENT.md` frontmatter and Markdown instructions, or accepts a plain object directly:

```ts
import { Agent } from "@jm3s4/agentrc";

const fromMarkdown = new Agent(`---
name: support-bot
version: 1.0.0
locale:
  language: es-CO
  timeZone: America/Bogota
model:
  id: gpt-4o
  temperature: 0.2
---
You are a concise customer support assistant.
`);

const fromObject = new Agent({
    name: "support-bot",
    version: "1.0.0",
    model: { id: "gpt-4o" },
    instructions: "You are a concise customer support assistant.",
});

const copy = new Agent(fromObject.toJSON());
const markdown = fromObject.toString();
```

`model` accepts extra provider fields, and `metadata` holds arbitrary key/value pairs. Other manifest objects reject unknown keys.

## System instructions

`agent.buildInstructions()` splits stable instructions from runtime variables and localized date context:

```ts
const built = agent.buildInstructions({
    variables: { tenantId: "clinic-12", channel: "web" },
    additionalInstructions: "Keep answers under 3 sentences.",
});

built.staticInstructions; // Agent body + <available_skills> catalog
built.dynamicInstructions; // Runtime variables + date for agent.locale + extra rules
built.toString(); // staticInstructions + dynamicInstructions joined
```

This is done to optimize token caching.

## Tools

`Tool` validates `inputSchema` on creation and checks arguments with Ajv before running.

### Programmatic handlers

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

await weather.execute({ city: "Bogota" });
```

### HTTP tools

`{{param}}` interpolates call arguments (URL encoded in `url`, raw in `headers` and `body`), and `{{secret.NAME}}` resolves runtime secrets:

```ts
import { Tool } from "@jm3s4/agentrc";

const lookup = new Tool(
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

await lookup.execute({ email: "ada@example.com" });
```

HTTP dispatch rejects protocols other than HTTP/HTTPS, disables redirects (`redirect: 'error'`), and blocks loopback, private subnets, cloud metadata (`169.254/16`, `fe80::/10`), CGNAT, and reserved IP ranges via `ipaddr.js`. Enable internal targets with `allowLoopback: true` or `allowPrivateIps: true`. Checks inspect the literal hostname before DNS; pass a custom `fetch` via `.configure({ fetch })` for DNS pinning or egress proxies.

## Skills

`Skill` validates `SKILL.md` frontmatter, formats `<available_skills>` XML catalogs, and reads `references/`, `assets/`, and `scripts/` lazily while blocking traversal paths (`..`, `/`, drive letters):

```ts
import { MemoryFileSystem, Skill } from "@jm3s4/agentrc";

const files = new MemoryFileSystem({
    "SKILL.md": `---
name: triage
description: Classify incoming support tickets by urgency.
---
Check billing outages before routing to tier 1 support.
`,
    "references/matrix.md": "# Priority Matrix\nP1: Service down",
});

const skill = await Skill.load(files);
const resources = await skill.listResources();
const matrix = await (await skill.getResource("references/matrix.md")).text();
```

## Loading bundles

When an `AGENT.md` directory references external tools and skills:

```text
support-bot/
├── AGENT.md
├── tools/lookup-account.yaml
└── skills/triage/
    ├── SKILL.md
    └── references/matrix.md
```

`Agent.load(files)` and `Skill.load(files)` work over any `FileSystem` implementing `{ read, list }`.

### Local disk (`@jm3s4/agentrc/node`)

`NodeFileSystem` resolves symlinks via `realpath` on reads and listings to prevent escapes outside the root directory:

```ts
import { Agent, Skill } from "@jm3s4/agentrc";
import { NodeFileSystem } from "@jm3s4/agentrc/node";

const agent = await Agent.load(new NodeFileSystem("./agents/support-bot"), {
    secrets: { API_KEY: process.env.API_KEY! },
    security: { allowedHosts: ["api.example.com"] },
});

const summaries = await Skill.discover(new NodeFileSystem("./skills"));
```

### In memory

```ts
import { Agent, MemoryFileSystem } from "@jm3s4/agentrc";

const base = await Agent.load(
    new MemoryFileSystem({
        "AGENT.md": agentMd,
        "tools/lookup-account.yaml": toolYaml,
        "skills/triage/SKILL.md": skillMd,
        "skills/triage/references/matrix.md": "# Matrix",
    }),
);

// Bind per tenant or per request without mutating `base`
const tenantAgent = base.configure({ secrets: tenantSecrets });
```

### SQL and object storage

```ts
import { Agent, type FileSystem, Skill, Tool } from "@jm3s4/agentrc";

function createSkillFiles(skillId: string): FileSystem {
    return {
        read: (path) => bucket.getObject(`skills/${skillId}/${path}`),
        list: async (prefix = "") => {
            const pattern = prefix ? `${prefix}/%` : "%";
            const rows = await sql<{ path: string }[]>`
                select path from skill_files
                where skill_id = ${skillId} and path like ${pattern}
            `;
            return rows.map((row) => row.path);
        },
    };
}

const agentRow = await sql.one`
    select id, manifest, instructions
    from agents where slug = ${slug} and tenant_id = ${tenantId}
`;
const toolRows = await sql`select definition from tools where agent_id = ${agentRow.id}`;
const skillRows = await sql`
    select id, name, description, instructions, metadata
    from skills where agent_id = ${agentRow.id}
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

## AI SDK integration

```ts
import { HttpError, ParseError, ValidationError } from "@jm3s4/agentrc";
import { dynamicTool, isStepCount, jsonSchema, ToolLoopAgent } from "ai";

const built = agent.buildInstructions({ variables: { tenantId: "clinic-12" } });

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

- **`ParseError`**: malformed frontmatter/YAML/JSON, missing template args or secrets, SSRF violations, missing files, or path traversal.
- **`ValidationError`**: schema failures on manifests, skills, tools, or `Tool.execute()` arguments (`.issues`).
- **`HttpError`**: transport failures (`502`), timeouts (`504`), or error responses (`response.status`) from HTTP tools.

## Contributing

Requires Node.js 26+ and pnpm. `node:*` imports are restricted to `lib/node/` and enforced by `pnpm nodecheck`.

```sh
pnpm install
pnpm check       # typecheck, lint, format check, test, nodecheck
```

## Releases

Versions follow SemVer (`0.x.y`). `pnpm version` updates `package.json`, syncs `jsr.json`, commits, and tags `vX.Y.Z`:

```sh
pnpm version minor
git push --follow-tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yaml` to validate manifests, run `pnpm check`, publish to JSR, and create a GitHub release (tags with `-` are marked as prereleases).

## License

[MIT](LICENSE)
