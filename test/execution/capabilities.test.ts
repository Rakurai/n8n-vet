/**
 * Unit tests for capability detection.
 *
 * Covers: MCP tool discovery, capability level determination,
 * partial MCP tool availability, toAvailableCapabilities mapper.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DetectedCapabilities, CapabilityLevel } from '../../src/execution/types.js';
import { toAvailableCapabilities, detectCapabilities } from '../../src/execution/capabilities.js';

// ---------------------------------------------------------------------------
// toAvailableCapabilities mapper
// ---------------------------------------------------------------------------

describe('toAvailableCapabilities', () => {
  it('maps mcp capabilities', () => {
    const detected: DetectedCapabilities = {
      level: 'mcp',
      mcpAvailable: true,
      mcpTools: ['test_workflow', 'get_execution', 'prepare_test_pin_data'],
    };

    const available = toAvailableCapabilities(detected);
    expect(available).toEqual({
      staticAnalysis: true,
      mcpTools: true,
    });
  });

  it('maps static-only capabilities (no MCP)', () => {
    const detected: DetectedCapabilities = {
      level: 'static-only',
      mcpAvailable: false,
      mcpTools: [],
    };

    const available = toAvailableCapabilities(detected);
    expect(available).toEqual({
      staticAnalysis: true,
      mcpTools: false,
    });
  });
});

// ---------------------------------------------------------------------------
// DetectedCapabilities type contracts
// ---------------------------------------------------------------------------

describe('DetectedCapabilities type', () => {
  it('represents mcp capability with all MCP tools', () => {
    const caps: DetectedCapabilities = {
      level: 'mcp',
      mcpAvailable: true,
      mcpTools: ['test_workflow', 'get_execution', 'prepare_test_pin_data'],
    };
    expect(caps.level).toBe('mcp');
    expect(caps.mcpTools).toHaveLength(3);
  });

  it('level corresponds to MCP availability', () => {
    const levels: Array<[CapabilityLevel, boolean]> = [
      ['mcp', true],
      ['static-only', false],
    ];

    for (const [level, mcp] of levels) {
      const caps: DetectedCapabilities = {
        level,
        mcpAvailable: mcp,
        mcpTools: mcp ? ['test_workflow'] : [],
      };
      expect(caps.mcpAvailable).toBe(mcp);
    }
  });
});

// ---------------------------------------------------------------------------
// detectCapabilities
// ---------------------------------------------------------------------------

describe('detectCapabilities', () => {
  it('no callTool → level static-only', async () => {
    const result = await detectCapabilities();

    expect(result.level).toBe('static-only');
    expect(result.mcpAvailable).toBe(false);
    expect(result.mcpTools).toEqual([]);
  });

  it('MCP tools available → level mcp', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });

    const result = await detectCapabilities({ callTool });

    expect(result.level).toBe('mcp');
    expect(result.mcpAvailable).toBe(true);
    expect(result.mcpTools).toEqual([
      'test_workflow',
      'get_execution',
      'prepare_test_pin_data',
    ]);
  });

  it('MCP tools partially available → mcpTools has only responding tools', async () => {
    const callTool = vi.fn()
      .mockRejectedValueOnce(new Error('tools/list not found'))  // tools/list — unavailable
      .mockResolvedValueOnce({ content: [] })   // test_workflow — available
      .mockResolvedValueOnce({ content: [] })   // get_execution — available
      .mockRejectedValueOnce(new Error('tool not found')); // prepare_test_pin_data — unavailable

    const result = await detectCapabilities({ callTool });

    expect(result.mcpTools).toEqual(['test_workflow', 'get_execution']);
    expect(result.mcpAvailable).toBe(true);
  });

  it('all MCP tools fail → level static-only', async () => {
    const callTool = vi.fn()
      .mockRejectedValueOnce(new Error('tools/list not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'));

    const result = await detectCapabilities({ callTool });

    expect(result.level).toBe('static-only');
    expect(result.mcpAvailable).toBe(false);
    expect(result.mcpTools).toEqual([]);
  });
});
