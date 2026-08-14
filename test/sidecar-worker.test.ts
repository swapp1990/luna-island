import { describe, expect, it } from 'vitest'
import {
  BudgetTracker,
  handleDecide,
  healthPayload,
  type SidecarDeps,
} from '../scripts/luna-budget'
import {
  FakeMcpServer,
  MCP_FRESH_TOOL,
  createMindWorkerPool,
  mcpToolResult,
} from '../scripts/luna-mcp-worker'

function scratch() {
  return '/tmp/luna-mind-test'
}

describe('persistent mind worker (P3-7)', () => {
  it('enforces a fresh conversation (codex, never codex-reply) per request', async () => {
    const server = new FakeMcpServer((call) => {
      call.respond(mcpToolResult(`{"n":${server.toolCalls.length}}`))
    })
    const pool = createMindWorkerPool({
      createTransport: () => server.transport(),
      fallback: async () => ({ text: 'FALLBACK', latencyMs: 1 }),
      maxWorkers: 1,
      scratchDir: scratch(),
      handshakeTimeoutMs: 200,
      backoffMs: () => 0,
    })

    const a = await pool.decide('sys-A', 'Remember the codeword BLUEMOON.')
    const b = await pool.decide('sys-B', 'What codeword were you told?')
    expect(a.worker).toBe('mcp')
    expect(b.worker).toBe('mcp')
    expect(a.text).toBe('{"n":1}')
    expect(b.text).toBe('{"n":2}')

    expect(server.toolCalls.map((c) => c.name)).toEqual([MCP_FRESH_TOOL, MCP_FRESH_TOOL])
    expect(server.toolCalls.some((c) => c.name === 'codex-reply')).toBe(false)
    expect(server.written.some((m) => (m as { method?: string }).method === 'tools/call' && (m as { params?: { name?: string } }).params?.name === 'codex-reply')).toBe(false)

    const prompts = server.toolCalls.map((c) => String(c.args.prompt ?? ''))
    expect(prompts[0]).toContain('Remember the codeword BLUEMOON.')
    expect(prompts[1]).toContain('What codeword were you told?')
    expect(prompts[1]).not.toContain('BLUEMOON')
    for (const call of server.toolCalls) {
      expect(call.args.threadId).toBeUndefined()
      expect(call.args.conversationId).toBeUndefined()
      expect(call.args.sandbox).toBe('read-only')
    }
    pool.dispose()
  })

  it('timeout cancels the MCP request and restarts a wedged worker', async () => {
    const servers: FakeMcpServer[] = []
    const pool = createMindWorkerPool({
      createTransport: () => {
        const server = new FakeMcpServer((call) => {
          if (servers.length === 1) return
          call.respond(mcpToolResult('{"ok":1}'))
        })
        servers.push(server)
        return server.transport()
      },
      fallback: async () => ({ text: 'FALLBACK', latencyMs: 1 }),
      maxWorkers: 1,
      scratchDir: scratch(),
      killMs: 40,
      cancelGraceMs: 15,
      handshakeTimeoutMs: 200,
      backoffMs: () => 0,
    })

    await expect(pool.decide('s', 'u')).rejects.toThrow(/kill-timeout/)
    expect(servers[0]!.cancelled.length).toBe(1)
    expect(servers[0]!.killed.length).toBeGreaterThanOrEqual(1)

    await expect
      .poll(() => servers.length, { timeout: 500 })
      .toBeGreaterThanOrEqual(2)

    const recovered = await pool.decide('s', 'again')
    expect(recovered.worker).toBe('mcp')
    expect(recovered.text).toBe('{"ok":1}')
    expect(servers[1]!.toolCalls[0]?.name).toBe(MCP_FRESH_TOOL)
    pool.dispose()
  })

  it('falls back to cold exec when the worker cannot start', async () => {
    let fallbacks = 0
    const pool = createMindWorkerPool({
      createTransport: () => {
        throw new Error('spawn exploded')
      },
      fallback: async () => {
        fallbacks += 1
        return { text: '{"from":"exec"}', latencyMs: 4 }
      },
      maxWorkers: 1,
      scratchDir: scratch(),
      handshakeTimeoutMs: 50,
      maxRestarts: 3,
      backoffMs: () => 0,
    })

    const r = await pool.decide('s', 'u')
    expect(r.worker).toBe('exec')
    expect(r.text).toBe('{"from":"exec"}')
    expect(fallbacks).toBe(1)
    expect(pool.status()).toBe('fallback')
    expect(healthPayload(new BudgetTracker({ maxPerHour: 60, maxPerDay: 300 }, { skipLoad: true }), scratch(), pool.status()).worker).toBe('fallback')
    pool.dispose()
  })

  it('budget gate still precedes every worker / fallback call', async () => {
    let transports = 0
    let fallbacks = 0
    const server = new FakeMcpServer()
    const pool = createMindWorkerPool({
      createTransport: () => {
        transports += 1
        return server.transport()
      },
      fallback: async () => {
        fallbacks += 1
        return { text: 'nope', latencyMs: 1 }
      },
      maxWorkers: 1,
      scratchDir: scratch(),
      backoffMs: () => 0,
    })
    const budget = new BudgetTracker(
      { maxPerHour: 0, maxPerDay: 300 },
      { skipLoad: true },
    )
    const deps: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget,
      runner: (s, u) => pool.decide(s, u),
    }
    const blocked = await handleDecide(deps, { system: 's', user: 'u' })
    expect(blocked.status).toBe(402)
    expect(blocked.json.error).toBe('budget')
    expect(transports).toBe(0)
    expect(fallbacks).toBe(0)
    expect(server.toolCalls.length).toBe(0)
    expect(server.written.length).toBe(0)
    pool.dispose()
  })

  it('health payload reports worker status', () => {
    const budget = new BudgetTracker({ maxPerHour: 60, maxPerDay: 300 }, { skipLoad: true })
    expect(healthPayload(budget, scratch(), 'up').worker).toBe('up')
    expect(healthPayload(budget, scratch(), 'restarting').worker).toBe('restarting')
    expect(healthPayload(budget, scratch(), 'fallback').worker).toBe('fallback')
  })

  it('strips fenced JSON from the MCP tool result', async () => {
    const server = new FakeMcpServer((call) => {
      call.respond(mcpToolResult('```json\n{"action":"wander","reasoning":"ok"}\n```'))
    })
    const pool = createMindWorkerPool({
      createTransport: () => server.transport(),
      fallback: async () => ({ text: 'FALLBACK', latencyMs: 1 }),
      maxWorkers: 1,
      scratchDir: scratch(),
      backoffMs: () => 0,
    })
    const r = await pool.decide('s', 'u')
    expect(r.text).toBe('{"action":"wander","reasoning":"ok"}')
    pool.dispose()
  })
})
