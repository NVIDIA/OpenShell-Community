/**
 * NeMoClaw DevX — Gateway Bridge
 *
 * Discovers the OpenClaw app element's GatewayBrowserClient and exposes
 * helpers for sending config.patch RPCs without importing any openclaw internals.
 */

interface GatewayClient {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

interface ConfigSnapshot {
  hash?: string;
  [key: string]: unknown;
}

/**
 * Returns the live GatewayBrowserClient from the <openclaw-app> element,
 * or null if the app hasn't connected yet.
 */
export function getClient(): GatewayClient | null {
  const app = document.querySelector("openclaw-app") as
    | (HTMLElement & { client?: GatewayClient | null })
    | null;
  return app?.client ?? null;
}

/**
 * Wait until the gateway client is available (polls every 500ms, up to timeoutMs).
 */
export function waitForClient(timeoutMs = 15_000): Promise<GatewayClient> {
  return new Promise((resolve, reject) => {
    const existing = getClient();
    if (existing) {
      resolve(existing);
      return;
    }

    const start = Date.now();
    const interval = setInterval(() => {
      const client = getClient();
      if (client) {
        clearInterval(interval);
        resolve(client);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for OpenClaw gateway client"));
      }
    }, 500);
  });
}

/**
 * Send a config.patch RPC to merge a partial config into the running configuration.
 *
 * 1. Calls config.get to obtain the current baseHash
 * 2. Calls config.patch with the serialised patch + baseHash
 *
 * Throws on gateway errors so callers can surface them to the user.
 */
export async function patchConfig(patch: Record<string, unknown>): Promise<void> {
  const client = getClient();
  if (!client) {
    throw new Error("OpenClaw gateway not connected");
  }

  const snapshot = await client.request<ConfigSnapshot>("config.get", {});
  const baseHash = snapshot?.hash;

  const result = await client.request<{ ok?: boolean }>("config.patch", {
    raw: JSON.stringify(patch),
    ...(baseHash ? { baseHash } : {}),
  });

  if (result && typeof result === "object" && "ok" in result && !result.ok) {
    throw new Error("config.patch was rejected by the server");
  }
}

/**
 * Check whether the <openclaw-app> element reports `connected === true`.
 */
export function isAppConnected(): boolean {
  const app = document.querySelector("openclaw-app") as
    | (HTMLElement & { connected?: boolean })
    | null;
  return app?.connected === true;
}

/**
 * Wait for the gateway to reconnect after a restart (e.g. after config.patch).
 *
 * Polls <openclaw-app>.connected every 500ms. Resolves when the app is
 * connected again, or rejects after timeoutMs.
 */
export function waitForReconnect(timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isAppConnected()) {
      resolve();
      return;
    }

    const start = Date.now();
    const interval = setInterval(() => {
      if (isAppConnected()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for gateway to reconnect"));
      }
    }, 500);
  });
}
