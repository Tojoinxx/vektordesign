/**
 * Schlanker Client für die Claude Messages API (direkt aus dem Browser / der Desktop-App).
 * Doku: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
 */

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (empfohlen)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (stärker, langsamer)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (schnell, günstig)' },
] as const;

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: string | ContentBlock[]; is_error?: boolean };

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ApiResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'pause_turn' | string;
  usage?: { input_tokens: number; output_tokens: number };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CallOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: Message[];
  tools?: ToolDef[];
  toolChoice?: { type: 'auto' | 'any' } | { type: 'tool'; name: string };
  maxTokens?: number;
  signal?: AbortSignal;
  /** Für Tests austauschbar */
  fetchImpl?: typeof fetch;
}

function germanError(status: number, type: string | undefined, msg: string | undefined): string {
  if (status === 401) return 'Der API-Schlüssel ist ungültig. Bitte in den Assistent-Einstellungen prüfen.';
  if (status === 403) return 'Der API-Schlüssel hat keine Berechtigung für dieses Modell.';
  if (status === 404) return 'Das gewählte Modell ist nicht verfügbar. Bitte ein anderes Modell wählen.';
  if (status === 413) return 'Die Anfrage ist zu groß (z. B. zu viele Objekte).';
  if (status === 429) return 'Zu viele Anfragen in kurzer Zeit – bitte kurz warten und erneut versuchen.';
  if (status === 529 || type === 'overloaded_error') return 'Claude ist gerade überlastet – bitte gleich noch einmal versuchen.';
  if (status >= 500) return 'Der Claude-Dienst antwortet gerade nicht. Bitte später erneut versuchen.';
  return msg ? `Anfrage abgelehnt: ${msg}` : `Anfrage fehlgeschlagen (HTTP ${status}).`;
}

export async function callClaude(o: CallOptions): Promise<ApiResponse> {
  if (!o.apiKey) throw new ApiError('Kein API-Schlüssel hinterlegt. Bitte in den Assistent-Einstellungen eintragen.', 0);
  const body: Record<string, unknown> = {
    model: o.model,
    max_tokens: o.maxTokens ?? 2048,
    // Systemprompt (inkl. Werkzeugliste davor) wird zwischengespeichert → günstiger bei Folgeanfragen
    system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
    messages: o.messages,
  };
  if (o.tools?.length) body.tools = o.tools;
  if (o.toolChoice) body.tool_choice = o.toolChoice;
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': o.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: o.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new ApiError('Abgebrochen.', -1);
    throw new ApiError('Keine Verbindung zu Claude. Ist das Gerät online?', 0);
  }
  if (!res.ok) {
    let type: string | undefined;
    let msg: string | undefined;
    try {
      const j = (await res.json()) as { error?: { type?: string; message?: string } };
      type = j.error?.type;
      msg = j.error?.message;
    } catch {
      /* leer */
    }
    throw new ApiError(germanError(res.status, type, msg), res.status);
  }
  return (await res.json()) as ApiResponse;
}

// ---- Einstellungen (nur lokal auf diesem Gerät) ----

const KEY_KEY = 'vd.claude.apiKey';
const MODEL_KEY = 'vd.claude.model';

export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(k: string): void {
  try {
    if (k) localStorage.setItem(KEY_KEY, k);
    else localStorage.removeItem(KEY_KEY);
  } catch {
    /* privater Modus */
  }
}

export function loadModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? MODELS[0].id;
  } catch {
    return MODELS[0].id;
  }
}

export function saveModel(m: string): void {
  try {
    localStorage.setItem(MODEL_KEY, m);
  } catch {
    /* privater Modus */
  }
}
