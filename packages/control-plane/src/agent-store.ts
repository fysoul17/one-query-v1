import type { Database } from 'bun:sqlite';
import type { AgentDefinition, AgentId, AgentStoreInterface, AIBackend } from '@autonomy/shared';

interface AgentRow {
  id: string;
  name: string;
  role: string;
  tools: string;
  can_modify_files: number;
  can_delegate_to_agents: number;
  max_concurrent: number;
  owner: string;
  persistent: number;
  created_by: string;
  created_at: string;
  system_prompt: string;
  session_id: string | null;
  backend: string | null;
  backend_model: string | null;
  source: string;
  user_modified: number;
  updated_at: string;
}

function deriveSource(createdBy: string): string {
  if (createdBy === 'seed') return 'seed';
  if (createdBy === 'conductor') return 'conductor';
  return 'api';
}

export class AgentStore implements AgentStoreInterface {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        tools TEXT NOT NULL DEFAULT '[]',
        can_modify_files INTEGER NOT NULL DEFAULT 0,
        can_delegate_to_agents INTEGER NOT NULL DEFAULT 0,
        max_concurrent INTEGER NOT NULL DEFAULT 1,
        owner TEXT NOT NULL,
        persistent INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        session_id TEXT,
        backend TEXT,
        backend_model TEXT,
        source TEXT NOT NULL DEFAULT 'api',
        user_modified INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);
  }

  save(definition: AgentDefinition): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO agents (id, name, role, tools, can_modify_files, can_delegate_to_agents,
        max_concurrent, owner, persistent, created_by, created_at, system_prompt,
        session_id, backend, backend_model, source, user_modified, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        definition.id,
        definition.name,
        definition.role,
        JSON.stringify(definition.tools),
        definition.canModifyFiles ? 1 : 0,
        definition.canDelegateToAgents ? 1 : 0,
        definition.maxConcurrent,
        definition.owner,
        definition.persistent ? 1 : 0,
        definition.createdBy,
        definition.createdAt,
        definition.systemPrompt,
        definition.sessionId ?? null,
        definition.backend ?? null,
        definition.backendModel ?? null,
        deriveSource(definition.createdBy),
        now,
      ],
    );
  }

  update(id: AgentId, definition: AgentDefinition): void {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE agents SET name = ?, role = ?, tools = ?, can_modify_files = ?,
        can_delegate_to_agents = ?, max_concurrent = ?, owner = ?, persistent = ?,
        system_prompt = ?, session_id = ?, backend = ?, backend_model = ?,
        user_modified = 1, updated_at = ?
       WHERE id = ?`,
      [
        definition.name,
        definition.role,
        JSON.stringify(definition.tools),
        definition.canModifyFiles ? 1 : 0,
        definition.canDelegateToAgents ? 1 : 0,
        definition.maxConcurrent,
        definition.owner,
        definition.persistent ? 1 : 0,
        definition.systemPrompt,
        definition.sessionId ?? null,
        definition.backend ?? null,
        definition.backendModel ?? null,
        now,
        id,
      ],
    );
  }

  delete(id: AgentId): void {
    this.db.run('DELETE FROM agents WHERE id = ?', [id]);
  }

  getById(id: AgentId): AgentDefinition | null {
    const row = this.db.query('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | null;
    return row ? this.rowToDefinition(row) : null;
  }

  list(): AgentDefinition[] {
    const rows = this.db.query('SELECT * FROM agents ORDER BY created_at ASC').all() as AgentRow[];
    return rows.map((r) => this.rowToDefinition(r));
  }

  upsertSeed(definition: AgentDefinition): boolean {
    const existing = this.db
      .query('SELECT source, user_modified FROM agents WHERE id = ?')
      .get(definition.id) as { source: string; user_modified: number } | null;

    if (!existing) {
      this.save(definition);
      return true;
    }

    if (existing.source === 'seed' && existing.user_modified === 0) {
      const now = new Date().toISOString();
      this.db.run(
        `UPDATE agents SET name = ?, role = ?, tools = ?, can_modify_files = ?,
          can_delegate_to_agents = ?, max_concurrent = ?, owner = ?, persistent = ?,
          system_prompt = ?, session_id = ?, backend = ?, backend_model = ?,
          updated_at = ?
         WHERE id = ?`,
        [
          definition.name,
          definition.role,
          JSON.stringify(definition.tools),
          definition.canModifyFiles ? 1 : 0,
          definition.canDelegateToAgents ? 1 : 0,
          definition.maxConcurrent,
          definition.owner,
          definition.persistent ? 1 : 0,
          definition.systemPrompt,
          definition.sessionId ?? null,
          definition.backend ?? null,
          definition.backendModel ?? null,
          now,
          definition.id,
        ],
      );
      return true;
    }

    // User-modified or non-seed source — skip
    return false;
  }

  private rowToDefinition(row: AgentRow): AgentDefinition {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      tools: JSON.parse(row.tools) as string[],
      canModifyFiles: row.can_modify_files === 1,
      canDelegateToAgents: row.can_delegate_to_agents === 1,
      maxConcurrent: row.max_concurrent,
      owner: row.owner as AgentDefinition['owner'],
      persistent: row.persistent === 1,
      createdBy: row.created_by,
      createdAt: row.created_at,
      systemPrompt: row.system_prompt,
      sessionId: row.session_id ?? undefined,
      backend: (row.backend ?? undefined) as AIBackend | undefined,
      backendModel: row.backend_model ?? undefined,
    };
  }
}
