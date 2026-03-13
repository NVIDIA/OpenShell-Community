// SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import serverModule from '../server.js';
const { server, _resetForTesting } = serverModule;
import setupModule from './setup.js';
const { cleanTempFiles } = setupModule;
const request = supertest;

// === TC-SF01 through TC-SF06: Static file serving ===

describe("static file serving", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterAll(() => {
    server.close();
  });

  it("TC-SF01: GET /styles.css returns CSS with text/css content-type", async () => {
    const res = await request(server).get("/styles.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.text).toContain("OpenShell");
  });

  it("TC-SF02: GET /app.js returns JS with application/javascript content-type", async () => {
    const res = await request(server).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
  });

  it("TC-SF03: GET /nonexistent.txt returns 404", async () => {
    const res = await request(server).get("/nonexistent.txt");
    expect(res.status).toBe(404);
  });

  it("TC-SF04: GET / returns templated index.html", async () => {
    const res = await request(server).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).not.toContain("{{OTHER_AGENTS_MODAL}}");
    expect(res.text).toContain("OpenShell");
  });

  it("TC-SF05: GET /index.html returns templated index.html", async () => {
    const res = await request(server).get("/index.html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).not.toContain("{{OTHER_AGENTS_MODAL}}");
  });

  it("TC-SF06: HEAD /styles.css returns headers but no body", async () => {
    const res = await request(server).head("/styles.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.text).toBeFalsy();
  });
});
