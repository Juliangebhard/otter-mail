import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { documentKey, type Project } from "@otter-mail/contracts/projects";

/** The relay, as far as projects go: its projects, and every call made to it. */
const relay = {
  projects: new Map<string, Project>(),
  calls: [] as string[],
  /** Fails calls (the relay unreachable) while set. */
  down: false,
};

class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

vi.mock("./otter-account.js", () => ({
  RelayError,
  getOtterUser: () => ({ id: "u1", email: "me@example.com", name: null, picture: null }),
  async relayRequest(method: string, route: string, body?: Record<string, unknown>) {
    if (relay.down) throw new RelayError(0, "offline");
    relay.calls.push(`${method} ${route}`);
    const [, , , id, kind, ...rest] = route.split("/").map(decodeURIComponent);
    if (method === "GET")
      return { projects: [...relay.projects.values()].map((p) => structuredClone(p)) };
    const project = relay.projects.get(id);
    if (!kind) {
      if (method === "DELETE") relay.projects.delete(id);
      else
        relay.projects.set(id, {
          threads: [],
          links: [],
          ...project,
          ...(body as object),
          id,
          updatedAt: 1,
        } as Project);
      return null;
    }
    if (!project) throw new RelayError(404, "No such project.");
    if (kind === "threads") {
      const [email, threadId] = rest;
      project.threads = project.threads.filter(
        (t) => !(t.email === email && t.threadId === threadId),
      );
      if (method === "PUT")
        project.threads.push({ email, threadId, subject: "", ...(body as { addedAt: number }) });
    } else {
      project.links = project.links.filter((l) => l.id !== rest[0]);
      if (method === "PUT")
        project.links.push({
          id: rest[0],
          ...(body as { url: string; title: string; addedAt: number }),
        });
    }
    return null;
  },
}));
vi.mock("./account-store.js", () => ({ listAccounts: async () => [] }));
vi.mock("./mail-store.js", () => ({}));
vi.mock("../providers/index.js", () => ({}));

const files = new Map<string, string>();
const { setPlatform } = await import("../platform.ts");
setPlatform({
  broadcast: () => {},
  log: () => {},
  files: {
    read: async (name: string) =>
      files.has(name) ? new TextEncoder().encode(files.get(name)) : null,
    write: async (name: string, data: Uint8Array | string) => void files.set(name, String(data)),
  },
} as never);

const projects = await import("./projects.ts");

/** Lets the debounced push run (short of a retry, 30 seconds on). */
async function settle() {
  await vi.advanceTimersByTimeAsync(1_000);
  await projects.listProjects();
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe("projects", () => {
  it("writes each change to the relay: the project first, then its threads and links", async () => {
    const project = await projects.createProject({ name: "Acme contract" });
    await projects.addThreads(project.id, [
      { email: "Me@Example.com", threadId: "t1", subject: "Redlines" },
    ]);
    const link = await projects.addLink(project.id, { url: "https://docs.example/contract" });
    await settle();

    expect(relay.calls).toEqual([
      `PUT /v1/projects/${project.id}`,
      `PUT /v1/projects/${project.id}/threads/me%40example.com/t1`,
      `PUT /v1/projects/${project.id}/links/${link.id}`,
    ]);
    expect(relay.projects.get(project.id)).toMatchObject({
      name: "Acme contract",
      threads: [{ email: "me@example.com", threadId: "t1", subject: "" }],
      links: [{ url: "https://docs.example/contract", title: "https://docs.example/contract" }],
    });

    // The relay keeps no subjects; this device keeps its own through a pull.
    await projects.pullProjects();
    expect((await projects.listProjects())[0].threads[0].subject).toBe("Redlines");

    await projects.updateProject(project.id, { status: "settled" });
    await settle();
    expect(relay.projects.get(project.id)?.status).toBe("settled");
    expect(relay.projects.get(project.id)?.settledAt).toBeGreaterThan(0);
  });

  it("takes the account's projects, and keeps the changes the relay doesn't have yet", async () => {
    relay.projects.clear();
    const mine = await projects.createProject({ name: "Hire" });
    await settle();

    // Another device adds a thread and a project; here, offline, a link.
    relay.projects
      .get(mine.id)!
      .threads.push({ email: "a@x.com", threadId: "t9", subject: "", addedAt: 5 });
    relay.projects.set("p_other", {
      id: "p_other",
      name: "Lease",
      status: "active",
      notes: "",
      createdAt: 1,
      updatedAt: 1,
      settledAt: null,
      threads: [],
      links: [],
    });
    relay.down = true;
    await projects.addLink(mine.id, { url: "https://example.com/offer" });
    await settle();

    relay.down = false;
    await projects.pullProjects();
    const here = await projects.listProjects();
    const hire = here.find((p) => p.id === mine.id);
    expect(here.find((p) => p.id === "p_other")?.name).toBe("Lease");
    expect(hire?.threads.map((t) => t.threadId)).toEqual(["t9"]);
    expect(hire?.links.map((l) => l.url)).toEqual(["https://example.com/offer"]);

    // …and then writes it.
    await settle();
    expect(relay.projects.get(mine.id)?.links).toHaveLength(1);
  });

  it("drops a project deleted on another device, and a change the relay refuses", async () => {
    relay.projects.clear();
    const gone = await projects.createProject({ name: "Gone" });
    await settle();
    relay.projects.delete(gone.id);
    await projects.pullProjects();
    expect((await projects.listProjects()).some((p) => p.id === gone.id)).toBe(false);

    // A thread written to a project deleted meanwhile: the relay says 404, and it's dropped.
    const kept = await projects.createProject({ name: "Kept" });
    await settle();
    relay.projects.delete(kept.id);
    await projects.addThreads(kept.id, [{ email: "a@x.com", threadId: "t1", subject: "" }]);
    await settle();
    expect(JSON.parse(files.get("projects.json")!).pending).toEqual([]);
  });

  it("deletes a project with everything pending for it", async () => {
    relay.calls = [];
    relay.down = true;
    const project = await projects.createProject({ name: "Short-lived" });
    await projects.addThreads(project.id, [{ email: "a@x.com", threadId: "t1", subject: "" }]);
    await projects.deleteProject(project.id);
    await settle();
    relay.down = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(relay.calls).toEqual([`DELETE /v1/projects/${project.id}`]);
  });
});

describe("documentKey", () => {
  it("groups versions of a document, and keeps different documents apart", () => {
    const key = documentKey("Northwind_Order_Form_v1.pdf");
    expect(documentKey("Northwind Order Form v2 (redlines).pdf")).toBe(key);
    expect(documentKey("Northwind_Order_Form_FINAL.pdf")).toBe(key);
    expect(documentKey("northwind-order-form (1).pdf")).toBe(key);
    expect(documentKey("Northwind Order Form 2026-09-28 signed.pdf")).toBe(key);
    expect(documentKey("Northwind_Order_Form_v1.docx")).not.toBe(key);
    expect(documentKey("Northwind_Security_Questionnaire.pdf")).not.toBe(key);
    expect(documentKey("Q4-planning-agenda.pdf")).toBe("q4 planning agenda.pdf");
    expect(documentKey("v2.pdf")).toBe("v2.pdf");
  });
});
