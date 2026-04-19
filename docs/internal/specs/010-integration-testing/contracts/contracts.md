# Contracts: Integration Testing Suite

**Feature**: 010-integration-testing
**Date**: 2026-04-19

## Overview

The integration test suite does not expose external interfaces. It consumes the n8n-vet library API and n8n's REST API. The contracts below define the internal interfaces between test components.

## Assertion Helpers Contract

Functions in `lib/assertions.ts` provide typed assertions over n8n-vet's output types. Each throws with a descriptive message on failure.

```
assertStatus(summary, expected)
  Input: DiagnosticSummary, one of 'pass' | 'fail' | 'error' | 'skipped'
  Throws: if summary.status !== expected

assertFindingPresent(summary, classification)
  Input: DiagnosticSummary, ErrorClassification string
  Throws: if no finding matches the classification

assertNoFindings(summary)
  Input: DiagnosticSummary
  Throws: if any findings exist

assertTrusted(status, nodeName)
  Input: TrustStatusReport, node name string
  Throws: if node is not in trusted set

assertUntrusted(status, nodeName)
  Input: TrustStatusReport, node name string
  Throws: if node is not in untrusted set

assertGuardrailAction(summary, kind)
  Input: DiagnosticSummary, GuardrailAction kind string
  Throws: if no guardrail action matches the kind
```

## MCP Test Client Contract

`lib/mcp-client.ts` provides a typed client that communicates with n8n-vet's MCP server over stdio.

```
createMcpTestClient()
  Returns: McpTestClient
  Spawns: node dist/mcp/serve.js as child process
  Connects: via StdioClientTransport

McpTestClient.validate(input)
  Input: { workflowPath, target?, layer?, force?, pinData?, destinationNode? }
  Returns: McpResponse (JSON with success/data/error)

McpTestClient.trustStatus(input)
  Input: { workflowPath }
  Returns: McpResponse

McpTestClient.explain(input)
  Input: { workflowPath, target?, layer? }
  Returns: McpResponse

McpTestClient.close()
  Terminates child process and cleans up transport
```

## Push Utility Contract

`lib/push.ts` wraps n8nac push with OCC conflict handling.

```
pushFixture(fixturePath)
  Input: absolute path to .ts fixture file
  Behavior:
    1. Run n8nac push <fixturePath>
    2. If OCC conflict → retry with --mode keep-current
    3. If second push fails → throw
  Returns: void (success) or throws (real error)
```

## Setup/Teardown Contract

`lib/setup.ts` manages test infrastructure lifecycle.

```
setup()
  Behavior:
    1. Verify n8n reachable (GET /api/v1/workflows)
    2. Verify n8nac available (n8nac --version)
    3. Verify API key configured
    4. Create temp dirs for trust state and snapshots
    5. Load manifest from fixtures/manifest.json
  Returns: IntegrationContext
  Throws: if any prerequisite fails

IntegrationContext.cleanup()
  Behavior: Remove temp dirs
  Returns: void
```
