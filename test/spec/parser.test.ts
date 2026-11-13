import { describe, expect, it } from 'bun:test';
import { parseAgent, ParseError, parseTool, stringifyAgent, stringifyTool, ValidationError } from '../../lib';

const validAgentMd = `---
apiVersion: agent.ekisa.com.co/v1
kind: Agent

metadata:
  name: support-bot
  version: 1.0.0
  displayName: "Support Bot"
  description: "Handles customer queries"

spec:
  model:
    id: openrouter/deepseek/deepseek-v4.1-flash
  runtime:
    maxSteps: 8
  tools:
    - ./tools/lookup.yaml
---

You are an expert customer support agent.
Answer accurately and empathetically.

---

Keep responses concise.
`;

const validToolYaml = `
name: lookup-account
displayName: "Lookup Account"
description: "Looks up customer details by ID."
inputSchema:
  type: object
  required:
    - account_id
  properties:
    account_id:
      type: string
execution:
  type: http
  method: GET
  url: "https://api.example.com/accounts/{{account_id}}"
`;

describe('parseAgent', () => {
    it('parses a valid AGENT.md document', () => {
        const doc = parseAgent(validAgentMd);

        expect(doc.manifest.metadata.name).toBe('support-bot');
        expect(doc.manifest.metadata.version).toBe('1.0.0');
        expect(doc.manifest.spec.model.id).toBe('openrouter/deepseek/deepseek-v4.1-flash');
        expect(doc.manifest.spec.runtime.maxSteps).toBe(8);
        expect(doc.manifest.spec.locale.language).toBe('en-US'); // applied default

        // Verifies the markdown instructions preserve internal horizontal rules ('---')
        expect(doc.instructions).toContain('You are an expert customer support agent.');
        expect(doc.instructions).toContain('---\n\nKeep responses concise.');
    });

    it('parses document with empty instructions', () => {
        const doc = parseAgent(`---
apiVersion: agent.ekisa.com.co/v1
kind: Agent
metadata:
  name: minimal
  version: 1.0.0
spec:
  model:
    id: gpt-4o
---`);

        expect(doc.manifest.metadata.name).toBe('minimal');
        expect(doc.instructions).toBe('');
    });

    it('rejects document missing opening delimiter', () => {
        expect(() =>
            parseAgent(`
apiVersion: agent.ekisa.com.co/v1
kind: Agent
---
Prompt here`),
        ).toThrow(ParseError);
    });

    it('rejects document missing closing delimiter', () => {
        expect(() =>
            parseAgent(`---
apiVersion: agent.ekisa.com.co/v1
kind: Agent
metadata:
  name: broken
  version: 1.0.0
spec:
  model:
    id: gpt-4o
`),
        ).toThrow(ParseError);
    });

    it('rejects malformed YAML syntax', () => {
        expect(() =>
            parseAgent(`---
apiVersion: agent.ekisa.com.co/v1
kind: [unclosed
---
Hello`),
        ).toThrow(ParseError);
    });

    it('rejects schema violation with ValidationError', () => {
        expect(() =>
            parseAgent(`---
apiVersion: agent.ekisa.com.co/v1
kind: Agent
metadata:
  name: "INVALID_UPPERCASE"
  version: "1.0.0"
spec:
  model:
    id: gpt-4o
---
Prompt`),
        ).toThrow(ValidationError);
    });

    it('round-trips document serialization', () => {
        const doc = parseAgent(validAgentMd);
        const serialized = stringifyAgent(doc);
        const reparsed = parseAgent(serialized);

        expect(reparsed.manifest).toEqual(doc.manifest);
        expect(reparsed.instructions).toEqual(doc.instructions);
    });
});

describe('parseTool', () => {
    it('parses a valid standalone tool file', () => {
        const tool = parseTool(validToolYaml);

        expect(tool.name).toBe('lookup-account');
        expect(tool.displayName).toBe('Lookup Account');
        expect(tool.execution?.method).toBe('GET');
        expect(tool.inputSchema.type).toBe('object');
    });

    it('rejects invalid JSON Schema in tool definition', () => {
        const badTool = `
name: bad-tool
description: "A tool with broken schema"
inputSchema:
  type: not-a-valid-json-schema-type
`;
        expect(() => parseTool(badTool)).toThrow(ValidationError);
    });

    it('round-trips tool serialization', () => {
        const tool = parseTool(validToolYaml);
        const serialized = stringifyTool(tool);
        const reparsed = parseTool(serialized);

        expect(reparsed).toEqual(tool);
    });
});
