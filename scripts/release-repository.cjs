const DEFAULT_RELEASE_REPOSITORY = "tuziapi/tuzi-switch";
const RELEASE_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function resolveReleaseRepository(env = process.env) {
  const releaseRepository =
    env.VITE_RELEASE_REPOSITORY?.trim() ||
    env.TUZI_SWITCH_RELEASE_REPOSITORY?.trim() ||
    env.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_RELEASE_REPOSITORY;

  if (!RELEASE_REPOSITORY_PATTERN.test(releaseRepository)) {
    throw new Error(`Invalid release repository: ${releaseRepository}`);
  }

  return releaseRepository;
}

module.exports = {
  DEFAULT_RELEASE_REPOSITORY,
  resolveReleaseRepository,
};
