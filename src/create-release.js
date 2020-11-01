const github = require('@actions/github');
const core = require('@actions/core');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  try {
    // Get authenticated GitHub client (Ocktokit): https://github.com/actions/toolkit/tree/master/packages/github#usage
    const myToken = process.env.GITHUB_TOKEN;
    const octokit = github.getOctokit(myToken);

    // Get owner and repo from context of payload that triggered the action
    const { owner, repo } = github.context.repo;

    // Get the inputs from the workflow file: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    const backupTagName = core.getInput('backup_tag_name');
    const tagName = core.getInput('tag_name', { required: true });

    // This removes the 'refs/tags' portion of the string, i.e. from 'refs/tags/v1.10.15' to 'v1.10.15'
    const tag = tagName.replace('refs/tags/', '');
    const backupTag = backupTagName.replace('refs/tags/', '');
    const releaseName = core.getInput('release_name', { required: true }).replace('refs/tags/', '');
    const body = core.getInput('body', { required: false });
    const draft = core.getInput('draft', { required: false }) === 'true';
    const prerelease = core.getInput('prerelease', { required: false }) === 'true';

    let backupReleaseSha;

    try {
      core.info('Trying to find existing release tag');
      const tagResponse = await octokit.git.getRef({
        owner,
        repo,
        ref: `tags/${tag}`
      });
      backupReleaseSha = tagResponse.data.object.sha;
      core.info(`Found existing release tag at ${backupReleaseSha}`);
    } catch (e) {
      // Do nothing
      core.info(`Error looking for existing release tag: ${e}`);
    }

    try {
      core.info('Trying to find existing release');
      // Get old release with `tag`
      const oldRelease = await octokit.repos.getReleaseByTag({
        owner,
        repo,
        tag
      });

      if (backupTag) {
        try {
          // Try to find backup release
          core.info('Find backup release');
          const backupRelease = await octokit.repos.getReleaseByTag({
            owner,
            repo,
            tag: backupTag
          });

          // Delete backup release
          core.info('Delete backup release');
          await octokit.repos.deleteRelease({
            owner,
            repo,
            release_id: backupRelease.data.id
          });

          core.info('Waiting for 10 seconds after backup release was deleted');
          await sleep(10 * 1000);
        } catch (e) {
          core.info(`Error deleting existing backup release: ${e}`);
          // Do nothing
        }

        core.info('Making current release a backup release');
        // Move current `tag` release to `backupTag`
        await octokit.repos.updateRelease({
          owner,
          repo,
          release_id: oldRelease.data.id,
          tag_name: backupTag,
          name: `${oldRelease.data.name} BACKUP`,
          body: `THIS IS A BACKUP
            ${oldRelease.data.body}`
        });

        core.info('Updating backup tag');
        await octokit.git.updateRef({
          owner,
          repo,
          ref: `tags/${backupTag}`,
          sha: backupReleaseSha,
          force: true
        });

        core.info('Waiting for 10 seconds after backup tag was updated');
        await sleep(10 * 1000);
      } else {
        core.info(`Deleting old release (${oldRelease.data.id})`);
        await octokit.repos.deleteRelease({
          owner,
          repo,
          release_id: oldRelease.data.id
        });

        core.info('Waiting for 10 seconds after release was deleted');
        await sleep(10 * 1000);
      }

      // Delete `tag` tag
      core.info(`Deleting release tag (${tag})`);
      await octokit.git.deleteRef({
        owner,
        repo,
        ref: `tags/${tag}`
      });

      core.info('Waiting for 10 seconds after release tag was deleted');
      await sleep(10 * 1000);
    } catch (e) {
      // Do nothing
      core.info(`Error cleaning up old releases: ${e}`);
    }

    // Create a release
    // API Documentation: https://developer.github.com/v3/repos/releases/#create-a-release
    // Octokit Documentation: https://octokit.github.io/rest.js/#octokit-routes-repos-create-release
    const createReleaseResponse = await octokit.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      name: releaseName,
      body,
      draft,
      prerelease
    });

    // Get the ID, html_url, and upload URL for the created Release from the response
    const releaseId = createReleaseResponse.data.id;
    const htmlUrl = createReleaseResponse.data.html_url;
    const uploadUrl = createReleaseResponse.data.upload_url;

    core.info(`Release ID: ${releaseId}`);
    core.info(`HTML URL: ${htmlUrl}`);
    core.info(`Upload URL: ${uploadUrl}`);

    // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    core.setOutput('id', releaseId);
    core.setOutput('html_url', htmlUrl);
    core.setOutput('upload_url', uploadUrl);
  } catch (error) {
    core.info(`something failed: ${error}`);
    core.setFailed(error.message);
  }
}

module.exports = run;
