/**
 * `keyline link [project] --env <env>` — bind the current directory to a
 * workspace/project/environment, writing a `.keyline.json` that push/pull read.
 *
 * The project name defaults to the folder's name (#36): in the happy path a
 * new user just types `keyline link`. Finds the project (by slug) and
 * environment (by name) in your workspace, creating them if they don't exist,
 * then persists the binding.
 */

import { basename, resolve } from "node:path";
import { ApiClient, ApiError } from "../api-client.js";
import type { KeyStore } from "../keystore.js";
import { loadAccount } from "../account.js";
import { isCredentialValid, loadCredentials } from "../credentials.js";
import { type ProjectConfig, saveProjectConfig } from "../config.js";

export interface LinkInput {
  /** Project name; defaults to the linked folder's name. */
  project?: string;
  environment: string;
  dir?: string;
}

export interface LinkDeps {
  apiBaseUrl: string;
  store: KeyStore;
  fetchImpl?: typeof fetch;
}

interface Project {
  id: string;
  slug: string;
  name: string;
}
interface Environment {
  id: string;
  name: string;
}

/** lowercase, hyphen-separated slug (matches the API's project slug rules). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function runLink(deps: LinkDeps, input: LinkInput): Promise<ProjectConfig> {
  const creds = loadCredentials(deps.store);
  if (!isCredentialValid(creds)) {
    throw new Error("Not logged in. Run `keyline login` first.");
  }
  const account = loadAccount(deps.store);
  if (!account) throw new Error("No account on this device. Run `keyline login` first.");

  const projectName = input.project ?? basename(resolve(input.dir ?? process.cwd()));
  const slug = slugify(projectName);
  if (!slug) {
    throw new Error(
      input.project
        ? `invalid project name: ${JSON.stringify(input.project)}`
        : `cannot make a project name out of this folder (${JSON.stringify(projectName)}); pass one: keyline link <project>`,
    );
  }

  const api = new ApiClient({ baseUrl: deps.apiBaseUrl, token: creds.token, fetchImpl: deps.fetchImpl });

  // Find or create the project.
  const { projects } = await api.get<{ projects: Project[] }>(
    `/v1/workspaces/${account.workspaceId}/projects`,
  );
  let project = projects.find((p) => p.slug === slug);
  if (!project) {
    project = await api.post<Project>(`/v1/workspaces/${account.workspaceId}/projects`, {
      name: projectName,
      slug,
    });
  }

  // Find or create the environment.
  const { environments } = await api.get<{ environments: Environment[] }>(
    `/v1/projects/${project.id}/environments`,
  );
  let env = environments.find((e) => e.name === input.environment);
  if (!env) {
    env = await api.post<Environment>(`/v1/projects/${project.id}/environments`, {
      name: input.environment,
    });
  }

  const config: ProjectConfig = {
    workspaceId: account.workspaceId,
    projectId: project.id,
    environmentId: env.id,
    projectSlug: project.slug,
    environmentName: env.name,
  };
  saveProjectConfig(config, input.dir);
  return config;
}

/** Turn an auth failure into a friendly message. */
export function explainLinkError(err: unknown): string {
  if (err instanceof ApiError && (err.status === 401 || err.code === "unauthorized")) {
    return "Your session expired. Run `keyline login` again.";
  }
  return err instanceof Error ? err.message : String(err);
}
