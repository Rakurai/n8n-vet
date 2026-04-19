/**
 * Graph construction and workflow parsing — transforms a parsed WorkflowAST
 * into a traversable WorkflowGraph with bidirectional adjacency maps, node
 * classifications, and a displayName→propertyName index for expression resolution.
 *
 * Also provides parseWorkflowFile() to auto-detect and parse .ts/.json files.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ConnectionAST, NodeAST, WorkflowAST } from '@n8n-as-code/transformer';
import type { Edge, GraphNode, WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import { nodeIdentity } from '../types/identity.js';
import { classifyNode } from './classify.js';
import { ConfigurationError, MalformedWorkflowError } from './errors.js';

/**
 * Construct a traversable WorkflowGraph from a parsed WorkflowAST.
 *
 * Enforces invariants:
 * - Node property names are unique
 * - Every node referenced in a connection exists in the node map
 * - displayNameIndex has an entry for every node
 *
 * @throws {MalformedWorkflowError} if invariants are violated.
 */
export function buildGraph(ast: WorkflowAST): WorkflowGraph {
  const nodes = new Map<NodeIdentity, GraphNode>();
  const displayNameIndex = new Map<string, NodeIdentity>();

  // Build node map and displayNameIndex
  for (const nodeAst of ast.nodes) {
    const name = nodeIdentity(nodeAst.propertyName);

    if (nodes.has(name)) {
      throw new MalformedWorkflowError(`Duplicate node property name: '${name}'`);
    }

    const graphNode: GraphNode = {
      name,
      displayName: nodeAst.displayName,
      type: nodeAst.type,
      typeVersion: nodeAst.version,
      parameters: nodeAst.parameters,
      credentials: nodeAst.credentials ?? null,
      disabled: (nodeAst as NodeAST & { disabled?: boolean }).disabled ?? false,
      classification: classifyNode(nodeAst),
    };

    nodes.set(name, graphNode);

    if (displayNameIndex.has(nodeAst.displayName)) {
      throw new MalformedWorkflowError(`Duplicate node displayName: '${nodeAst.displayName}'`);
    }
    displayNameIndex.set(nodeAst.displayName, name);
  }

  // Build edges and adjacency maps
  const forward = new Map<NodeIdentity, Edge[]>();
  const backward = new Map<NodeIdentity, Edge[]>();

  // Initialize empty arrays for all nodes
  for (const name of nodes.keys()) {
    forward.set(name, []);
    backward.set(name, []);
  }

  for (const conn of ast.connections) {
    const edge = connectionToEdge(conn);

    if (!nodes.has(edge.from)) {
      throw new MalformedWorkflowError(
        `Connection references non-existent source node: '${edge.from}'`,
      );
    }
    if (!nodes.has(edge.to)) {
      throw new MalformedWorkflowError(
        `Connection references non-existent destination node: '${edge.to}'`,
      );
    }

    forward.get(edge.from)?.push(edge);
    backward.get(edge.to)?.push(edge);
  }

  return { nodes, forward, backward, displayNameIndex, ast };
}

/**
 * Parse a workflow file into a WorkflowAST. Auto-detects format by extension.
 *
 * - `.ts` files are parsed via `TypeScriptParser.parseFile()` (async)
 * - `.json` files are read, parsed as JSON, and converted via `JsonToAstParser.parse()`
 *
 * @throws {ConfigurationError} if `@n8n-as-code/transformer` is not available.
 * @throws {MalformedWorkflowError} if the file cannot be parsed.
 */
export async function parseWorkflowFile(filePath: string): Promise<WorkflowAST> {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.ts') {
    return await parseTypeScriptFile(filePath);
  }

  if (ext === '.json') {
    return await parseJsonFile(filePath);
  }

  throw new MalformedWorkflowError(`Unsupported file extension '${ext}'. Expected .ts or .json`);
}

async function parseTypeScriptFile(filePath: string): Promise<WorkflowAST> {
  try {
    const { TypeScriptParser } = await import('@n8n-as-code/transformer');
    const parser = new TypeScriptParser();
    return await parser.parseFile(filePath);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Cannot find module')) {
      throw new ConfigurationError('@n8n-as-code/transformer');
    }
    throw err;
  }
}

async function parseJsonFile(filePath: string): Promise<WorkflowAST> {
  try {
    const { JsonToAstParser } = await import('@n8n-as-code/transformer');
    const raw = await readFile(filePath, 'utf-8');
    const json: unknown = JSON.parse(raw);
    const parser = new JsonToAstParser();
    return parser.parse(json as import('@n8n-as-code/transformer').N8nWorkflow);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Cannot find module')) {
      throw new ConfigurationError('@n8n-as-code/transformer');
    }
    throw err;
  }
}

/**
 * Convert a ConnectionAST to an Edge.
 */
function connectionToEdge(conn: ConnectionAST): Edge {
  return {
    from: nodeIdentity(conn.from.node),
    fromOutput: conn.from.output,
    isError: conn.from.isError ?? false,
    to: nodeIdentity(conn.to.node),
    toInput: conn.to.input,
  };
}
