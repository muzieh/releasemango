import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGitAdapter } from "../../src/git/index.js";
import type { GitAdapter } from "../../src/git/index.js";
import { withTemporaryDirectory } from "./temporary-directory.js";

export interface GitRepositoryPaths {
  readonly root: string;
  readonly repository: string;
  readonly home: string;
  readonly globalConfig: string;
  readonly systemConfig: string;
}

export interface GitRepositoryFixture {
  readonly git: GitAdapter;
  readonly paths: GitRepositoryPaths;
}

export async function withGitRepository<T>(
  useRepository: (fixture: GitRepositoryFixture) => Promise<T>,
): Promise<T> {
  return withTemporaryDirectory(async (root) => {
    const repository = join(root, "repository");
    const home = join(root, "home");
    const xdgConfigHome = join(root, "xdg-config");
    const isolatedGlobalConfig = join(root, "isolated-global.gitconfig");
    const systemConfig = join(root, "system.gitconfig");
    const templateDirectory = join(root, "git-template");
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(xdgConfigHome, { recursive: true }),
      mkdir(templateDirectory, { recursive: true }),
      writeFile(isolatedGlobalConfig, ""),
    ]);

    const paths = Object.freeze({
      root,
      repository,
      home,
      globalConfig: join(home, ".gitconfig"),
      systemConfig,
    });
    const git = createGitAdapter(repository, {
      environment: {
        HOME: home,
        XDG_CONFIG_HOME: xdgConfigHome,
        GIT_CONFIG_GLOBAL: isolatedGlobalConfig,
        GIT_CONFIG_SYSTEM: systemConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TEMPLATE_DIR: templateDirectory,
      },
    });

    return useRepository(Object.freeze({ git, paths }));
  });
}
