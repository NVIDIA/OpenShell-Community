// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * OpenClaw Slack Socket Mode proxy patch.
 *
 * Monkey-patches the `ws` WebSocket constructor to inject a custom
 * https.Agent that tunnels through the HTTP CONNECT proxy for Slack
 * WebSocket hosts.
 */

'use strict';

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY  ||
  process.env.https_proxy ||
  process.env.http_proxy;

if (proxyUrl) {
  try {
    const http   = require('http');
    const https  = require('https');
    const tls    = require('tls');
    const { URL } = require('url');

    const parsed = new URL(proxyUrl);
    const proxyHost = parsed.hostname;
    const proxyPort = parseInt(parsed.port, 10) || 3128;

    const origHttpRequest = http.request;

    /**
     * Custom https.Agent that establishes a CONNECT tunnel through the
     * sandbox proxy, then does TLS over the tunnel.
     *
     * Uses the official (options, callback) signature of
     * Agent.prototype.createConnection, which supports async creation.
     */
    class ConnectProxyAgent extends https.Agent {
      createConnection(options, callback) {
        const host = options.host || options.hostname || options.servername;
        const port = options.port || 443;

        const proxyReq = origHttpRequest({
          host: proxyHost,
          port: proxyPort,
          method: 'CONNECT',
          path: `${host}:${port}`,
          headers: { Host: `${host}:${port}` },
        });

        proxyReq.on('connect', (res, socket, head) => {
          if (res.statusCode !== 200) {
            socket.destroy();
            callback(new Error(`CONNECT proxy returned ${res.statusCode}`));
            return;
          }

          // Wrap the raw tunnel in TLS (the agent is responsible for TLS)
          const tlsSocket = tls.connect({
            socket: socket,
            servername: host,
            rejectUnauthorized: options.rejectUnauthorized !== false,
          });

          tlsSocket.on('secureConnect', () => callback(null, tlsSocket));
          tlsSocket.on('error', (err) => callback(err));
        });

        proxyReq.on('error', (err) => callback(err));
        proxyReq.end();
      }
    }

    // One shared agent instance (keeps connections alive)
    const slackProxyAgent = new ConnectProxyAgent({ keepAlive: true });

    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      const result = origLoad.call(this, request, parent, isMain);

      if (request === 'ws' && result && result.WebSocket && !result.__proxyPatched) {
        const OrigWebSocket = result.WebSocket;

        class PatchedWebSocket extends OrigWebSocket {
          constructor(address, protocols, options) {
            if (typeof protocols === 'object' && !Array.isArray(protocols) &&
                protocols !== null && options === undefined) {
              options = protocols;
              protocols = undefined;
            }
            if (!options) options = {};

            if (typeof address === 'string' &&
                address.startsWith('wss://') &&
                (address.includes('wss-primary.slack.com') ||
                 address.includes('wss-backup.slack.com'))) {
              // Inject our proxy agent instead of createConnection
              options.agent = slackProxyAgent;
              console.log(
                `[ws-proxy-patch] Routing ${address.substring(0, 60)}... through proxy`
              );
            }

            if (protocols !== undefined) {
              super(address, protocols, options);
            } else {
              super(address, options);
            }
          }
        }

        result.WebSocket = PatchedWebSocket;
        result.__proxyPatched = true;
      }

      return result;
    };

    console.log(`[ws-proxy-patch] Slack WebSocket proxy active → ${proxyHost}:${proxyPort}`);
  } catch (err) {
    console.error('[ws-proxy-patch] Failed to initialize:', err.message);
  }
}
