import { defaultAgentId } from './helpers.mjs';

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

  async request(method, pathname, { query = {}, body } = {}) {
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
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = data?.error || text || `${response.status} ${response.statusText}`;
      throw new Error(`mnemo request failed: ${message}`);
    }

    return data;
  }

  async bulkCreate(memories) {
    return this.request('POST', this.tenantPath('/memories/bulk'), {
      body: { memories },
    });
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
}
