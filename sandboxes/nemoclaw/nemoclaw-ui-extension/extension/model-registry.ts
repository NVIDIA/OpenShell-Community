/**
 * NeMoClaw DevX — NVIDIA Model & Deploy Registry
 *
 * Static registry of available NVIDIA model endpoints.
 *
 * Each entry carries enough information to:
 *  1. Render the dropdown option
 *  2. Build a `config.patch` payload that adds the provider and switches
 *     `agents.defaults.model.primary`
 *
 * The two NVIDIA API platforms use separate API keys:
 *   - inference-api.nvidia.com  — NVIDIA_INFERENCE_API_KEY
 *   - integrate.api.nvidia.com  — NVIDIA_INTEGRATE_API_KEY
 *
 * Keys are resolved at call time: localStorage (user-entered) takes
 * priority, then the baked-in value (from sed/env substitution at
 * container startup), and finally the raw placeholder string.
 */

// ---------------------------------------------------------------------------
// API key storage — localStorage first, then baked-in fallback
// ---------------------------------------------------------------------------

const BAKED_INFERENCE_KEY = "__NVIDIA_INFERENCE_API_KEY__";
const BAKED_INTEGRATE_KEY = "__NVIDIA_INTEGRATE_API_KEY__";

const LS_INFERENCE_KEY = "nemoclaw:nvidia-inference-api-key";
const LS_INTEGRATE_KEY = "nemoclaw:nvidia-integrate-api-key";

export function getInferenceApiKey(): string {
  return localStorage.getItem(LS_INFERENCE_KEY) || BAKED_INFERENCE_KEY;
}

export function getIntegrateApiKey(): string {
  return localStorage.getItem(LS_INTEGRATE_KEY) || BAKED_INTEGRATE_KEY;
}

export function setInferenceApiKey(key: string): void {
  if (key) localStorage.setItem(LS_INFERENCE_KEY, key);
  else localStorage.removeItem(LS_INFERENCE_KEY);
}

export function setIntegrateApiKey(key: string): void {
  if (key) localStorage.setItem(LS_INTEGRATE_KEY, key);
  else localStorage.removeItem(LS_INTEGRATE_KEY);
}

const PLACEHOLDER_KEYS = ["not-used", "unused", "placeholder", "none", "null", "undefined"];

export function isKeyConfigured(key: string): boolean {
  if (!key || !key.trim()) return false;
  const lower = key.trim().toLowerCase();
  if (lower.startsWith("__")) return false;
  return !PLACEHOLDER_KEYS.includes(lower);
}

/**
 * Read the `nvapi` URL search parameter (set by the welcome UI when
 * opening the OpenClaw tab), store it in localStorage for both key
 * types, and scrub the parameter from the URL so it doesn't linger
 * in browser history.  Returns true if a key was ingested.
 */
export function ingestKeysFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  const key = params.get("nvapi");
  if (!key) return false;

  setInferenceApiKey(key);
  setIntegrateApiKey(key);

  params.delete("nvapi");
  const qs = params.toString();
  const clean = qs
    ? `${window.location.pathname}?${qs}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", clean);
  return true;
}

// ---------------------------------------------------------------------------
// Key type — used by ModelEntry to resolve the right key at call time
// ---------------------------------------------------------------------------

export type ApiKeyType = "inference" | "integrate";

export function resolveApiKey(keyType: ApiKeyType): string {
  return keyType === "inference" ? getInferenceApiKey() : getIntegrateApiKey();
}

// ---------------------------------------------------------------------------
// Model provider / entry types
// ---------------------------------------------------------------------------

export interface ModelProviderConfig {
  baseUrl: string;
  api: string;
  apiKey?: string;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    input: string[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }>;
}

export interface ModelEntry {
  id: string;
  name: string;
  isDefault: boolean;
  providerKey: string;
  modelRef: string;
  keyType: ApiKeyType;
  providerConfig: ModelProviderConfig;
  isDynamic?: boolean;
}

// ---------------------------------------------------------------------------
// Curated models — hardcoded presets backed by the nvidia-inference provider.
// All route through inference.local; the NemoClaw proxy injects credentials.
// ---------------------------------------------------------------------------

export interface CuratedModel {
  id: string;
  name: string;
  modelId: string;
  providerName: string;
}

export const CURATED_MODELS: readonly CuratedModel[] = [
  {
    id: "curated-claude-opus",
    name: "Claude Opus 4.6",
    modelId: "aws/anthropic/bedrock-claude-opus-4-6",
    providerName: "nvidia-inference",
  },
  {
    id: "curated-gpt-oss",
    name: "GPT-OSS 20B",
    modelId: "nvidia/openai/gpt-oss-20b",
    providerName: "nvidia-inference",
  },
  {
    id: "curated-nemotron-super",
    name: "Nemotron 3 Super",
    modelId: "nvidia/nvidia/nemotron-3-super-preview",
    providerName: "nvidia-inference",
  },
  {
    id: "curated-qwen3",
    name: "Qwen3 Next 80B",
    modelId: "nvidia/qwen/qwen3-next-80b-a3b-instruct",
    providerName: "nvidia-inference",
  },
  {
    id: "curated-llama-70b",
    name: "Llama 3.3 70B",
    modelId: "nvidia/meta/llama-3.3-70b-instruct",
    providerName: "nvidia-inference",
  },
];

export function curatedToModelEntry(c: CuratedModel): ModelEntry {
  const key = `curated-${c.providerName}`;
  return {
    id: c.id,
    name: c.name,
    isDefault: c.id === "curated-claude-opus",
    providerKey: key,
    modelRef: `${key}/${c.modelId}`,
    keyType: "inference",
    isDynamic: true,
    providerConfig: {
      baseUrl: "https://inference.local/v1",
      api: "openai-completions",
      models: [
        {
          id: c.modelId,
          name: c.name,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 8192,
        },
      ],
    },
  };
}

export function getCuratedByModelId(modelId: string): CuratedModel | undefined {
  return CURATED_MODELS.find((c) => c.modelId === modelId);
}

// ---------------------------------------------------------------------------
// Legacy MODEL_REGISTRY — kept as the default model reference for bootstrap
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER_KEY = "custom-inference-api-nvidia-com";

export const MODEL_REGISTRY: readonly ModelEntry[] = [
  {
    id: "nvidia-claude-opus-4-6",
    name: "Claude Opus 4.6",
    isDefault: true,
    providerKey: DEFAULT_PROVIDER_KEY,
    modelRef: `${DEFAULT_PROVIDER_KEY}/aws/anthropic/bedrock-claude-opus-4-6`,
    keyType: "inference",
    providerConfig: {
      baseUrl: "https://inference.local/v1",
      api: "openai-completions",
      models: [
        {
          id: "aws/anthropic/bedrock-claude-opus-4-6",
          name: "Claude Opus 4.6",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200_000,
          maxTokens: 8192,
        },
      ],
    },
  },
];

export const DEFAULT_MODEL = MODEL_REGISTRY.find((m) => m.isDefault)!;

// ---------------------------------------------------------------------------
// Dynamic models — populated at runtime from configured providers
// ---------------------------------------------------------------------------

let dynamicModels: ModelEntry[] = [];

export function getDynamicModels(): readonly ModelEntry[] {
  return dynamicModels;
}

export function setDynamicModels(models: ModelEntry[]): void {
  dynamicModels = models;
}

export function getAllModels(): ModelEntry[] {
  const curated = CURATED_MODELS.map(curatedToModelEntry);
  return [...curated, ...dynamicModels];
}

export function getModelById(id: string): ModelEntry | undefined {
  const curated = CURATED_MODELS.find((c) => c.id === id);
  if (curated) return curatedToModelEntry(curated);
  return dynamicModels.find((m) => m.id === id) ?? MODEL_REGISTRY.find((m) => m.id === id);
}

export function getModelByCuratedModelId(modelId: string): ModelEntry | undefined {
  const curated = getCuratedByModelId(modelId);
  if (curated) return curatedToModelEntry(curated);
  return undefined;
}

/**
 * Build a ModelEntry for a provider managed through the inference tab.
 * These route through inference.local where the proxy injects credentials,
 * so no client-side API key is needed.
 */
export function buildDynamicEntry(
  providerName: string,
  modelId: string,
  providerType: string,
): ModelEntry {
  const curated = getCuratedByModelId(modelId);
  if (curated) return curatedToModelEntry(curated);

  const key = `dynamic-${providerName}`;
  return {
    id: key,
    name: `${modelId} (via ${providerName})`,
    isDefault: false,
    providerKey: key,
    modelRef: `${key}/${modelId}`,
    keyType: "inference",
    isDynamic: true,
    providerConfig: {
      baseUrl: "https://inference.local/v1",
      api: "openai-completions",
      models: [
        {
          id: modelId,
          name: `${modelId} (${providerType})`,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 8192,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Deploy targets (used by deploy-modal.ts)
// ---------------------------------------------------------------------------

export interface DeployTarget {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  apiKeyHeader: string;
}

export const DEPLOY_TARGETS: DeployTarget[] = [
  {
    id: "dgx-spark",
    name: "DGX Spark",
    description: "Personal AI computing with up to 128 GB unified memory",
    endpoint: "https://integrate.api.nvidia.com/v1/deployments/spark",
    apiKeyHeader: "Authorization",
  },
  {
    id: "dgx-station",
    name: "DGX Station",
    description: "Workgroup AI workstation with multi-GPU performance",
    endpoint: "https://integrate.api.nvidia.com/v1/deployments/station",
    apiKeyHeader: "Authorization",
  },
];

export function getApiKey(target: DeployTarget): string {
  if (target.endpoint.includes("integrate.api.nvidia.com")) {
    return getIntegrateApiKey();
  }
  return getInferenceApiKey();
}
