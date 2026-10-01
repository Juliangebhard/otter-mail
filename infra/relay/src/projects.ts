/**
 * The account's projects (contracts' projects.ts), in three tables: the
 * projects, their threads and their links, so that writes to different
 * parts of a project don't overwrite each other. Any write bumps the
 * project's `updatedAt`.
 */

import { and, count, eq, sql } from "drizzle-orm";
import {
  newProjectId,
  PROJECT_LIMITS,
  type Project,
  type ProjectFields,
  type PutProjectLinkRequest,
  type PutProjectThreadRequest,
} from "@otter-mail/contracts/projects";
import type { ProjectBackend } from "@otter-mail/contracts/project-tools";

import * as schema from "./schema.ts";
import type { Db } from "./store.ts";

const { projects, projectThreads, projectLinks } = schema;

/** Why a write didn't happen. */
export type Refusal = "missing" | "full";

export async function list(db: Db, userId: string): Promise<Project[]> {
  const [rows, threads, links] = await db.batch([
    db.select().from(projects).where(eq(projects.userId, userId)),
    db.select().from(projectThreads).where(eq(projectThreads.userId, userId)),
    db.select().from(projectLinks).where(eq(projectLinks.userId, userId)),
  ]);
  return rows
    .map((p): Project => ({
      id: p.id,
      name: p.name,
      status: p.status,
      notes: p.notes,
      createdAt: p.createdAt.getTime(),
      updatedAt: p.updatedAt.getTime(),
      settledAt: p.settledAt?.getTime() ?? null,
      threads: threads
        .filter((t) => t.projectId === p.id)
        .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
        .map((t) => ({
          email: t.email,
          threadId: t.threadId,
          subject: "",
          addedAt: t.addedAt.getTime(),
        })),
      links: links
        .filter((l) => l.projectId === p.id)
        .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
        .map((l) => ({ id: l.id, url: l.url, title: l.title, addedAt: l.addedAt.getTime() })),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

const project = (userId: string, id: string) =>
  and(eq(projects.userId, userId), eq(projects.id, id));

async function exists(db: Db, userId: string, id: string): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(project(userId, id));
  return Boolean(row);
}

const touch = (db: Db, userId: string, id: string) =>
  db.update(projects).set({ updatedAt: new Date() }).where(project(userId, id));

/** Creates the project or updates its fields. */
export async function put(
  db: Db,
  userId: string,
  id: string,
  fields: ProjectFields,
): Promise<Refusal | null> {
  if (!(await exists(db, userId, id))) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(projects)
      .where(eq(projects.userId, userId));
    if (n >= PROJECT_LIMITS.projects) return "full";
  }
  const values = {
    name: fields.name,
    status: fields.status,
    notes: fields.notes,
    createdAt: new Date(fields.createdAt),
    settledAt: fields.settledAt === null ? null : new Date(fields.settledAt),
  };
  await db
    .insert(projects)
    .values({ userId, id, ...values })
    .onConflictDoUpdate({
      target: [projects.userId, projects.id],
      // The first device to create it decides when it was.
      set: { ...values, createdAt: sql`${projects.createdAt}`, updatedAt: new Date() },
    });
  return null;
}

export async function remove(db: Db, userId: string, id: string): Promise<boolean> {
  const [removed] = await db.batch([
    db.delete(projects).where(project(userId, id)).returning({ id: projects.id }),
    db
      .delete(projectThreads)
      .where(and(eq(projectThreads.userId, userId), eq(projectThreads.projectId, id))),
    db
      .delete(projectLinks)
      .where(and(eq(projectLinks.userId, userId), eq(projectLinks.projectId, id))),
  ]);
  return removed.length > 0;
}

export async function putThread(
  db: Db,
  userId: string,
  projectId: string,
  email: string,
  threadId: string,
  thread: PutProjectThreadRequest,
): Promise<Refusal | null> {
  if (!(await exists(db, userId, projectId))) return "missing";
  const [{ n }] = await db
    .select({ n: count() })
    .from(projectThreads)
    .where(and(eq(projectThreads.userId, userId), eq(projectThreads.projectId, projectId)));
  if (n >= PROJECT_LIMITS.threads) return "full";
  await db.batch([
    db
      .insert(projectThreads)
      .values({ userId, projectId, email, threadId, addedAt: new Date(thread.addedAt) })
      .onConflictDoNothing(),
    touch(db, userId, projectId),
  ]);
  return null;
}

export async function removeThread(
  db: Db,
  userId: string,
  projectId: string,
  email: string,
  threadId: string,
): Promise<void> {
  await db.batch([
    db
      .delete(projectThreads)
      .where(
        and(
          eq(projectThreads.userId, userId),
          eq(projectThreads.projectId, projectId),
          eq(projectThreads.email, email),
          eq(projectThreads.threadId, threadId),
        ),
      ),
    touch(db, userId, projectId),
  ]);
}

export async function putLink(
  db: Db,
  userId: string,
  projectId: string,
  id: string,
  link: PutProjectLinkRequest,
): Promise<Refusal | null> {
  if (!(await exists(db, userId, projectId))) return "missing";
  const [{ n }] = await db
    .select({ n: count() })
    .from(projectLinks)
    .where(and(eq(projectLinks.userId, userId), eq(projectLinks.projectId, projectId)));
  if (n >= PROJECT_LIMITS.links) return "full";
  const values = { url: link.url, title: link.title, addedAt: new Date(link.addedAt) };
  await db.batch([
    db
      .insert(projectLinks)
      .values({ userId, projectId, id, ...values })
      .onConflictDoUpdate({
        target: [projectLinks.userId, projectLinks.projectId, projectLinks.id],
        set: { url: values.url, title: values.title },
      }),
    touch(db, userId, projectId),
  ]);
  return null;
}

export async function removeLink(
  db: Db,
  userId: string,
  projectId: string,
  id: string,
): Promise<void> {
  await db.batch([
    db
      .delete(projectLinks)
      .where(
        and(
          eq(projectLinks.userId, userId),
          eq(projectLinks.projectId, projectId),
          eq(projectLinks.id, id),
        ),
      ),
    touch(db, userId, projectId),
  ]);
}

const refused = (refusal: Refusal | null) => {
  if (refusal === "missing") throw new Error("No such project.");
  if (refusal === "full") throw new Error("That's more than a project can hold.");
};

/** The project tools' store: this account's projects; `changed` runs after each write. */
export function backend(db: Db, userId: string, changed: () => Promise<void>): ProjectBackend {
  const find = async (id: string) => {
    const found = (await list(db, userId)).find((p) => p.id === id);
    if (!found) throw new Error(`No project ${id}.`);
    return found;
  };
  return {
    list: () => list(db, userId),
    async create({ name, notes }) {
      const id = newProjectId();
      refused(
        await put(db, userId, id, {
          name,
          notes,
          status: "active",
          createdAt: Date.now(),
          settledAt: null,
        }),
      );
      await changed();
      return find(id);
    },
    async update(id, patch) {
      const current = await find(id);
      const status = patch.status ?? current.status;
      refused(
        await put(db, userId, id, {
          name: patch.name ?? current.name,
          notes: patch.notes ?? current.notes,
          status,
          createdAt: current.createdAt,
          settledAt:
            status === "active" ? null : status === current.status ? current.settledAt : Date.now(),
        }),
      );
      await changed();
      return find(id);
    },
    async addThread(id, { email, threadId }) {
      refused(await putThread(db, userId, id, email, threadId, { addedAt: Date.now() }));
      await changed();
    },
    async removeThread(id, email, threadId) {
      await removeThread(db, userId, id, email, threadId);
      await changed();
    },
    async addLink(id, { url, title }) {
      const current = await find(id);
      const existing = current.links.find((l) => l.url === url);
      if (existing) return existing;
      const link = { id: newProjectId("l"), url, title, addedAt: Date.now() };
      refused(await putLink(db, userId, id, link.id, link));
      await changed();
      return link;
    },
    async removeLink(id, linkId) {
      await removeLink(db, userId, id, linkId);
      await changed();
    },
  };
}
