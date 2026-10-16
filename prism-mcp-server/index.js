// PrismMCPServer — a zero-dependency Model Context Protocol server exposing the
// Prism catalog. Implements the MCP JSON-RPC 2.0 surface (initialize, tools/list,
// tools/call, ping) over a stdio transport, which is what Claude Desktop and the
// Anthropic API mcp_servers (stdio) integration speak.
//
// Design notes:
//   - No SDK dependency: the protocol is small and this keeps install/runtime trivial
//     and offline (matching Prism's single-file ethos). Tool definitions are shaped
//     exactly like MCP tools so migrating to @modelcontextprotocol/sdk later is a lift,
//     not a rewrite.
//   - Transport is pluggable (StdioTransport here); a test harness can call
//     handleMessage() directly.

import { CatalogStore } from './utils/catalog.js';
import { TerminalCatalogStore, resolveTerminalPaths } from './utils/terminal-catalog.js';
import { CollectionStore } from './utils/collections.js';
import { buildTools, ToolError } from './tools/index.js';
import { createLogger } from './utils/logger.js';
import { THEMES, designSystems } from './utils/themes.js';

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'prism-mcp-server';
export const SERVER_VERSION = '1.0.0';

export class PrismMCPServer {
  /**
   * @param {string} catalogPath  path to Prism.html (island) or catalog/manifest.json
   * @param {object} opts { watch, logger, terminal, terminalCatalogPath }
   *   terminal              inject a TerminalCatalogStore (tests)
   *   terminalCatalogPath   explicit .html/.json for the terminal catalog; by default it
   *                         is found next to catalogPath (Prism.html's
   *                         #prism-terminal-catalog island, else
   *                         prism-term/catalog/terminal-catalog.json)
   */
  constructor(catalogPath, opts = {}) {
    if (!catalogPath) throw new Error('PrismMCPServer requires a catalogPath');
    this.logger = opts.logger || createLogger(opts.logLevel);
    this.store = new CatalogStore(catalogPath, { watch: opts.watch !== false, logger: this.logger });
    // Collections (JFH-7): disk-backed named sets of effect ids. Caller may inject a
    // store (tests use inMemory) or point it at a specific file via opts.collectionsPath.
    this.collections = opts.collections || new CollectionStore({
      filePath: opts.collectionsPath,
      inMemory: opts.collectionsInMemory === true,
      logger: this.logger,
    });
    // Terminal catalog (prism-term facets): optional — tools report `unavailable`
    // when neither the island nor the JSON fallback exists.
    this.terminal = opts.terminal || new TerminalCatalogStore({
      ...resolveTerminalPaths(catalogPath, opts.terminalCatalogPath),
      watch: opts.watch !== false,
      logger: this.logger,
    });
    this.tools = buildTools();
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
    this.initialized = false;
    this.requestCount = 0;
    this.store.on('reload', (stats) => this.logger.info(`Catalog reloaded: ${stats.effects} effects`));
    this.terminal.on('reload', (stats) => this.logger.info(`Terminal catalog reloaded: ${stats.facets} facets`));
    this.terminal.on('error', () => { /* logged by the store; keep serving the last good copy */ });
  }

  async load() {
    await this.store.load();
    await this.terminal.load(); // never throws: an absent terminal catalog is fine
    return this;
  }

  // ---- JSON-RPC dispatch ----
  async handleMessage(msg) {
    // Notifications (no id) get no response.
    const isNotification = msg.id === undefined || msg.id === null;
    try {
      const result = await this.dispatch(msg);
      if (isNotification) return null;
      return { jsonrpc: '2.0', id: msg.id, result };
    } catch (err) {
      if (isNotification) {
        this.logger.warn(`Notification handler error: ${err.message}`);
        return null;
      }
      return this.errorResponse(msg.id, err);
    }
  }

  async dispatch(msg) {
    const { method, params } = msg;
    switch (method) {
      case 'initialize':
        return this.onInitialize(params);
      case 'initialized':
      case 'notifications/initialized':
        this.initialized = true;
        return {};
      case 'ping':
        return {};
      case 'tools/list':
        return this.onToolsList();
      case 'tools/call':
        return this.onToolsCall(params);
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  onInitialize(params) {
    this.initialized = true;
    const clientProto = params && params.protocolVersion;
    this.logger.info(`initialize from client (protocol ${clientProto || 'unspecified'})`);
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: serverInstructions(this.store, this.terminal),
    };
  }

  onToolsList() {
    return {
      tools: this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  }

  async onToolsCall(params) {
    if (!params || typeof params.name !== 'string') {
      throw new RpcError(-32602, 'tools/call requires a "name"');
    }
    const tool = this.toolMap.get(params.name);
    if (!tool) {
      throw new RpcError(-32602, `Unknown tool: ${params.name}`, {
        availableTools: this.tools.map((t) => t.name),
      });
    }
    const args = params.arguments || {};
    const started = Date.now();
    this.requestCount++;
    this.logger.debug(`tools/call ${params.name} args=${safeJson(args)}`);
    try {
      const out = await tool.handler(args, { store: this.store, collections: this.collections, terminal: this.terminal, logger: this.logger });
      const ms = Date.now() - started;
      this.logger.info(`tool ${params.name} ok (${ms}ms)`);
      return {
        content: [{ type: 'text', text: safeJson(out) }],
        isError: false,
      };
    } catch (err) {
      const ms = Date.now() - started;
      // ToolError -> structured, actionable tool result (isError:true), NOT a protocol error.
      if (err instanceof ToolError) {
        this.logger.warn(`tool ${params.name} error (${ms}ms): ${err.message}`);
        return {
          content: [{ type: 'text', text: safeJson({ error: err.message, code: err.code, data: err.data }) }],
          isError: true,
        };
      }
      // Unexpected error: still return as tool error so the agent gets a message.
      this.logger.error(`tool ${params.name} threw: ${err.stack || err.message}`);
      return {
        content: [{ type: 'text', text: safeJson({ error: err.message, code: 'internal_error' }) }],
        isError: true,
      };
    }
  }

  errorResponse(id, err) {
    if (err instanceof RpcError) {
      return { jsonrpc: '2.0', id, error: { code: err.code, message: err.message, data: err.data } };
    }
    this.logger.error(`Internal error: ${err.stack || err.message}`);
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error', data: { detail: err.message } } };
  }

  /** Attach a transport (must expose onMessage(cb) and send(obj)). */
  connect(transport) {
    this.transport = transport;
    transport.onMessage(async (msg) => {
      const res = await this.handleMessage(msg);
      if (res) transport.send(res);
    });
    transport.start && transport.start();
    this.logger.info(`${SERVER_NAME} v${SERVER_VERSION} connected (${this.tools.length} tools)`);
    return this;
  }

  close() {
    this.store.close();
    this.terminal.close();
    this.transport && this.transport.stop && this.transport.stop();
  }
}

/**
 * What a fresh agent needs to pick and apply components with this server alone. Counts come from the
 * loaded catalog and the theme registry, so they never go stale.
 */
export function serverInstructions(store, terminal) {
  const all = store && store.catalog ? store.all() : [];
  const galleries = store && store.catalog ? store.galleries().length : 0;
  const aws = all.filter((e) => e.gallery === 'aws').length;
  const ds = designSystems();
  const term = terminal && terminal.available ? terminal.meta() : null;
  return [
    `Prism: ${all.length} offline CSS/SVG components ("effects" or facets) in ${galleries} galleries, themed by ${ds.length} design systems in dark and light (${THEMES.length} themes), plus an AWS architecture diagram kit (${aws} gallery diagrams).`,
    'PICK: recommend_effects turns a plain request into selection filters and ranked picks (one group per need). Or search_effects with filters: roles (loading for spinners and skeletons, feedback for toasts, alerts and badges, action, input, navigation, data-display, media), dataShapes for charts (time-series for a trend, part-to-whole for shares of a total, comparison, distribution, correlation, flow, geo, single-value for a KPI), usableAsBackground:true for a backdrop behind content, layers (overlay floats above), reducedMotionSafe:true (static, or stops under prefers-reduced-motion) and selfAnimates:false for no motion, needsJs:false for CSS only. get_available_filters lists the values.',
    'APPLY: get_effect returns html, css and apply (the theme tokens it reads, its JS initializer source, motion, backdrop placement). compose { ids, theme } bundles several: css starts with the theme token block (theme: a theme id such as duolingo-light for one mode, a design system id such as duolingo for Auto, dark with light under prefers-color-scheme; tokens: a custom palette), then rootAttributes to set on <html> (data-mode="light" switches the light rules of the facets), scripts (initializers to run once after the markup), apply (the steps); document: true returns a complete page. compose_with_template lays effects out as stack, row, grid or card.',
    'THEMES: a theme is a :root token swap over identical html and css. get_theme_palette { theme } gives the :root css, rootAttributes and autoCss; get_component_variants and get_variants_for_theme show components across themes; derive_theme turns one brand color into a contrast-safe dark and light palette (pass its { dark, light } to compose as tokens); check_theme_contrast audits any token map or shipped theme (on-fill inks, --control-line, the top bar included).',
    'AWS DIAGRAMS: get_diagram_spec with no id lists the gallery by feature (tables, flows, v6, two-line notes, poster); get_diagram_spec { id } returns an editable JSON spec. resolve_aws_icon maps any name (text, CloudFormation, Terraform, draw.io, Mermaid, PlantUML) to an icon id; containers such as a security group are frames (groups kind sg). build_diagram compiles a spec (flows for the request path, tables for security group, network ACL and route rules whose rows light per packet, v6 for IPv6 packets, two-line notes for dual-stack CIDRs) and returns lint; lint_diagram checks layout; export_diagram writes svg (animated, still or a moment), png, storyboard, drawio or mermaid; import_diagram reads draw.io, Mermaid, PlantUML, D2, CloudFormation and Terraform (rules: true draws security group tables).',
    `TERMINAL: the prism-term catalog of command-line facets${term ? ` (${term.facetCount} facets in ${term.galleryCount} galleries)` : ''}: spinners, progress bars and counters, charts, TUI controls, ops views and scenes. list_terminal_galleries to start, search_terminal_facets or list_terminal_facets (maxGlyphs and maxColor keep to what the target terminal can draw, maxWidth / maxHeight to its size), get_terminal_facet for the module source and the run commands (usage.cli, usage.npx, usage.curl).`,
    'OTHER: saved searches (create_saved_search), collections (create_collection, export_collection), and facet authoring (validate_facet, create_facet).',
  ].join('\n');
}

export class RpcError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); }
  catch (e) { return JSON.stringify({ error: 'unserializable result', detail: String(e) }); }
}

/**
 * Stdio transport: newline-delimited JSON-RPC on stdin/stdout. This is the
 * transport Claude Desktop launches (command + args) and the Anthropic API uses
 * for local stdio MCP servers.
 */
export class StdioTransport {
  // Cap the pending (un-newline-terminated) buffer. A client that streams bytes
  // without ever sending a '\n' would otherwise grow this string without bound and
  // exhaust memory (CWE-400). 16MB comfortably exceeds any legitimate single message.
  static MAX_BUFFER_SIZE = 16 * 1024 * 1024;

  constructor({ input = process.stdin, output = process.stdout, maxBufferSize } = {}) {
    this.input = input;
    this.output = output;
    this.buffer = '';
    this.cb = null;
    this.maxBufferSize = maxBufferSize || StdioTransport.MAX_BUFFER_SIZE;
  }
  onMessage(cb) { this.cb = cb; }
  start() {
    this.input.setEncoding('utf8');
    this.input.on('data', (chunk) => {
      this.buffer += chunk;
      // Reject a single oversized (newline-less) message before it exhausts memory.
      if (this.buffer.length > this.maxBufferSize && this.buffer.indexOf('\n') === -1) {
        this.send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request', data: { detail: `Message exceeds ${this.maxBufferSize}-byte limit` } } });
        this.buffer = '';
        return;
      }
      let idx;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); }
        catch (e) {
          this.send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error', data: { detail: e.message } } });
          continue;
        }
        this.cb && this.cb(msg);
      }
    });
  }
  send(obj) { this.output.write(JSON.stringify(obj) + '\n'); }
  stop() { /* stdin close handled by process lifecycle */ }
}
