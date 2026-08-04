import { describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { startStudio, type StudioInstance } from "@resilireplay/studio";

interface Session {
  studio: StudioInstance;
  cookie: string;
  setCookie: string;
  csrf: string;
}

async function studioSession(): Promise<Session> {
  const studio = await startStudio({ rootDirectory: process.cwd(), port: 0 });
  const response = await fetch(studio.url);
  const html = await response.text();
  const setCookies = response.headers.getSetCookie();
  const setCookie = setCookies[0];
  const cookie = setCookie?.split(";", 1)[0];
  const csrf = /name="resilireplay-csrf" content="([A-Za-z0-9_-]+)"/u.exec(html)?.[1];
  if (!cookie || !csrf) throw new Error("Studio bootstrap did not establish a session");
  return { studio, cookie, setCookie, csrf };
}

async function request(
  session: Session,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; method?: string } = {},
): Promise<Response> {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return fetch(`${session.studio.url}${path}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      cookie: session.cookie,
      ...(body === undefined
        ? {}
        : {
            origin: session.studio.url,
            "content-type": "application/json",
            "x-resilireplay-csrf": session.csrf,
          }),
      ...options.headers,
    },
    ...(body === undefined ? {} : { body }),
  });
}

async function rawStatus(
  session: Session,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise<number>((resolveStatus, reject) => {
    const requestValue = httpRequest(
      {
        hostname: "127.0.0.1",
        port: session.studio.port,
        path,
        method: "GET",
        headers,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolveStatus(response.statusCode ?? 0));
      },
    );
    requestValue.once("error", reject);
    requestValue.end();
  });
}

describe("ResiliReplay Studio security and workflow", () => {
  it("binds to loopback and rejects Host, Origin, CSRF, traversal, and oversized bodies", async () => {
    const session = await studioSession();
    try {
      expect(session.studio.host).toBe("127.0.0.1");
      expect(session.studio.url).not.toContain(session.cookie.split("=")[1]);
      expect(session.setCookie).toContain("Max-Age=900");
      expect(session.studio.startupMs).toBeLessThan(5_000);

      const status = await request(session, "/api/status");
      expect(status.status).toBe(200);
      expect(status.headers.get("permissions-policy")).toContain("camera=()");
      expect(await status.json()).toMatchObject({ bind: "127.0.0.1", telemetry: false });

      const badHost = await rawStatus(session, "/api/status", {
        host: `attacker.example:${session.studio.port}`,
        cookie: session.cookie,
      });
      expect(badHost).toBe(403);

      const badOrigin = await request(session, "/api/status", {
        headers: { origin: "https://attacker.example" },
      });
      expect(badOrigin.status).toBe(403);

      const missingCsrf = await fetch(`${session.studio.url}/api/review`, {
        method: "POST",
        headers: {
          cookie: session.cookie,
          origin: session.studio.url,
          "content-type": "application/json",
        },
        body: JSON.stringify({ campaignPath: "examples/studio/campaign.yml" }),
      });
      expect(missingCsrf.status).toBe(403);

      const traversal = await request(session, "/api/review", {
        body: { campaignPath: "../outside.yml" },
      });
      expect(traversal.status).toBe(400);

      const oversized = await request(session, "/api/review", {
        body: { campaignPath: `examples/${"x".repeat(70_000)}` },
      });
      expect(oversized.status).toBe(413);

      const badContentType = await fetch(`${session.studio.url}/api/review`, {
        method: "POST",
        headers: {
          cookie: session.cookie,
          origin: session.studio.url,
          "content-type": "text/plain",
          "x-resilireplay-csrf": session.csrf,
        },
        body: "{}",
      });
      expect(badContentType.status).toBe(415);
    } finally {
      await session.studio.close();
    }
  });

  it("reviews redacted targets, requires single-use tool confirmation, runs, and serves allowlisted evidence", async () => {
    const session = await studioSession();
    try {
      const reviewedResponse = await request(session, "/api/review", {
        body: { campaignPath: "examples/studio/campaign.yml" },
      });
      expect(reviewedResponse.status).toBe(200);
      const reviewed = (await reviewedResponse.json()) as {
        campaignHash: string;
        requiresToolConfirmation: boolean;
        plans: unknown[];
      };
      expect(reviewed.requiresToolConfirmation).toBe(true);
      expect(JSON.stringify(reviewed.plans)).not.toMatch(/Bearer\s+[A-Za-z0-9]/u);

      const unconfirmed = await request(session, "/api/run", {
        body: { campaignHash: reviewed.campaignHash },
      });
      expect(unconfirmed.status).toBe(403);

      const confirmationResponse = await request(session, "/api/confirm", {
        body: {
          campaignHash: reviewed.campaignHash,
          acknowledgement: "reviewed-and-authorized",
        },
      });
      expect(confirmationResponse.status).toBe(200);
      const confirmation = (await confirmationResponse.json()) as { confirmationToken: string };

      const startedResponse = await request(session, "/api/run", {
        body: {
          campaignHash: reviewed.campaignHash,
          confirmationToken: confirmation.confirmationToken,
        },
      });
      expect(startedResponse.status).toBe(202);
      const { runId } = (await startedResponse.json()) as { runId: string };

      const reused = await request(session, "/api/run", {
        body: {
          campaignHash: reviewed.campaignHash,
          confirmationToken: confirmation.confirmationToken,
        },
      });
      expect(reused.status).toBe(403);

      let state: {
        state: string;
        run?: { summary: { passed: boolean }; runHash: string };
        artifacts?: Array<{ id: string; path: string; bytes: number }>;
        error?: string;
      } = { state: "running" };
      for (let attempt = 0; attempt < 120 && state.state === "running"; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        const response = await request(session, `/api/runs/${runId}`);
        expect(response.status).toBe(200);
        state = (await response.json()) as typeof state;
      }
      expect(state, state.error).toMatchObject({
        state: "complete",
        run: { summary: { passed: true } },
      });
      expect(state.artifacts?.length).toBeGreaterThan(8);
      expect(state.artifacts?.every((artifact) => !/^[A-Za-z]:[\\/]/u.test(artifact.path))).toBe(
        true,
      );

      const timeline = await request(session, `/api/runs/${runId}/timeline`);
      expect(timeline.status).toBe(200);
      const timelineValue = (await timeline.json()) as { events: unknown[] };
      expect(timelineValue.events.length).toBeGreaterThan(10);
      expect(JSON.stringify(timelineValue)).not.toContain("authorization");

      const artifact = state.artifacts?.find((item) => item.path.endsWith("campaign-run.json"));
      expect(artifact).toBeDefined();
      const download = await request(session, `/api/runs/${runId}/downloads/${artifact!.id}`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-disposition")).toContain("attachment");
      expect(await download.text()).toContain("resilireplay-campaign-run");
    } finally {
      await session.studio.close();
    }
  }, 30_000);

  it("releases listeners across repeated lifecycle starts", async () => {
    const ports: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const studio = await startStudio({ rootDirectory: process.cwd(), port: 0 });
      ports.push(studio.port);
      await studio.close();
      await expect(fetch(studio.url)).rejects.toThrow();
    }
    expect(ports).toHaveLength(10);
  });
});
