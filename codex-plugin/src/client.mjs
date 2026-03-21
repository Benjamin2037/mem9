import { defaultAgentId } from './helpers.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

function joinTags(tags) {
  if (!tags || tags.length === 0) {
    return '';
  }
  return tags.join(',');
}

export class MnemoClient {
  constructor({ baseUrl, tenantId, agentId, fetchImpl = fetch } = {}) {
    this.baseUrl = String(baseUrl || process.env.MNEMO_API_URL || 'http://localhost:8080').replace(/\/$/, '');
    this.tenantId = String(tenantId || process.env.MNEMO_TENANT_ID || '').trim();
    this.agentId = String(agentId || defaultAgentId()).trim();
    this.fetchImpl = fetchImpl;
  }

  ensureConfigured() {
    if (!this.baseUrl) {
      throw new Error('MNEMO_API_URL is required');
    }
    if (!this.tenantId) {
      throw new Error('MNEMO_TENANT_ID is required');
    }
  }

  tenantPath(pathname) {
    return `/v1alpha1/mem9s/${this.tenantId}${pathname}`;
  }

  async requestDetailed(method, pathname, { query = {}, body } = {}) {
    this.ensureConfigured();
    const url = new URL(this.baseUrl + pathname);
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const headers = {
      'X-Mnemo-Agent-Id': this.agentId,
    };
    const options = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(url, options);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message = data?.error || text || `${response.status} ${response.statusText}`;
      throw new Error(`mnemo request failed: ${message}`);
    }

    return {
      data,
      status: response.status,
      headers: response.headers,
    };
  }

  async request(method, pathname, options = {}) {
    const result = await this.requestDetailed(method, pathname, options);
    return result.data;
  }

  async createMemory(memory) {
    return this.requestDetailed('POST', this.tenantPath('/memories'), {
      body: memory,
    });
  }

  async bulkCreate(memories) {
    try {
      return await this.request('POST', this.tenantPath('/memories/bulk'), {
        body: { memories },
      });
    } catch (error) {
      if (!Array.isArray(memories) || memories.length !== 1 || !(error instanceof Error) || !error.message.includes('405')) {
        throw error;
      }
      const response = await this.createMemory(memories[0]);
      return {
        status: response.data?.status || (response.status === 202 ? 'accepted' : 'ok'),
        memories: [],
      };
    }
  }

  async listMemories({ query, tags, source, state, memoryType, agentId, sessionId, limit = 10, offset = 0 } = {}) {
    return this.request('GET', this.tenantPath('/memories'), {
      query: {
        q: query,
        tags: joinTags(tags),
        source,
        state,
        memory_type: memoryType,
        agent_id: agentId,
        session_id: sessionId,
        limit,
        offset,
      },
    });
  }

  async getMemory(id) {
    return this.request('GET', this.tenantPath(`/memories/${id}`));
  }

  async waitForMatch({ query, tags, source, state, memoryType, agentId, sessionId, limit = 20, timeoutMs = 15000, intervalMs = 1000, match }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const response = await this.listMemories({
        query,
        tags,
        source,
        state,
        memoryType,
        agentId,
        sessionId,
        limit,
        offset: 0,
      });
      const memories = response?.memories || [];
      const found = typeof match === 'function' ? memories.find((memory) => match(memory)) : memories[0];
      if (found) {
        return found;
      }
      await sleep(intervalMs);
    }
    return null;
  }
}
