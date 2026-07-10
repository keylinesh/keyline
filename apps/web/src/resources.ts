/**
 * Metadata resource calls for the dashboard (#40): projects, environments,
 * and the workspace name. Mirrors the CLI's slug rules so both create the
 * same projects. All metadata only (ADR-0002).
 */

import { request } from "./api.js";
import type { WebSession } from "./session.js";

export interface Project {
  id: string;
  name: string;
  slug: string;
}

export interface Environment {
  id: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
}

/** lowercase, hyphen-separated slug (same rules as the CLI). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const auth = (s: WebSession) => ({ token: s.token });

export function getWorkspace(s: WebSession): Promise<Workspace> {
  return request<Workspace>("GET", `/v1/workspaces/${s.workspaceId}`, auth(s));
}

export function renameWorkspace(s: WebSession, name: string): Promise<Workspace> {
  return request<Workspace>("PATCH", `/v1/workspaces/${s.workspaceId}`, { ...auth(s), body: { name } });
}

export async function listProjects(s: WebSession): Promise<Project[]> {
  const { projects } = await request<{ projects: Project[] }>(
    "GET",
    `/v1/workspaces/${s.workspaceId}/projects`,
    auth(s),
  );
  return projects;
}

export function createProject(s: WebSession, name: string): Promise<Project> {
  const slug = slugify(name);
  if (!slug) throw new Error("Give the project a name with letters or digits.");
  return request<Project>("POST", `/v1/workspaces/${s.workspaceId}/projects`, {
    ...auth(s),
    body: { name: name.trim(), slug },
  });
}

export function renameProject(s: WebSession, id: string, name: string): Promise<Project> {
  return request<Project>("PATCH", `/v1/projects/${id}`, { ...auth(s), body: { name: name.trim() } });
}

export function deleteProject(s: WebSession, id: string): Promise<void> {
  return request<void>("DELETE", `/v1/projects/${id}`, auth(s));
}

export async function listEnvironments(s: WebSession, projectId: string): Promise<Environment[]> {
  const { environments } = await request<{ environments: Environment[] }>(
    "GET",
    `/v1/projects/${projectId}/environments`,
    auth(s),
  );
  return environments;
}

export function createEnvironment(s: WebSession, projectId: string, name: string): Promise<Environment> {
  return request<Environment>("POST", `/v1/projects/${projectId}/environments`, {
    ...auth(s),
    body: { name: name.trim() },
  });
}

export function renameEnvironment(s: WebSession, id: string, name: string): Promise<Environment> {
  return request<Environment>("PATCH", `/v1/environments/${id}`, { ...auth(s), body: { name: name.trim() } });
}

export function deleteEnvironment(s: WebSession, id: string): Promise<void> {
  return request<void>("DELETE", `/v1/environments/${id}`, auth(s));
}
