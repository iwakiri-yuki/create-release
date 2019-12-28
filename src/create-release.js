const core = require('@actions/core');
const { GitHub, context } = require('@actions/github');

async function run() {
  try {
    // Get authenticated GitHub client (Ocktokit): https://github.com/actions/toolkit/tree/master/packages/github#usage
    const github = new GitHub(process.env.GITHUB_TOKEN);

    // Get owner and repo from context of payload that triggered the action
    const { owner, repo } = context.repo;

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
      const tagResponse = await github.git.getRef({
        owner,
        repo,
        ref: `tags/${tag}`
      });
      backupReleaseSha = tagResponse.data.object.sha;
    } catch (e) {
      // Do nothing
    }

    try {
      // Get old release with `tag`
      const oldRelease = await github.repos.getReleaseByTag({
        owner,
        repo,
        tag
      });

      if (backupTag) {
        try {
          // Try to find backup release
          const backupRelease = await github.repos.getReleaseByTag({
            owner,
            repo,
            tag: backupTag
          });

          // Delete backup release
          await github.repos.deleteRelease({
            owner,
            repo,
            release_id: backupRelease.data.id
          });
        } catch (e) {
          // Do nothing
        }

        // Move current `tag` release to `backupTag`
        await github.repos.updateRelease({
          owner,
          repo,
          release_id: oldRelease.data.id,
          tag_name: backupTag,
          name: `${oldRelease.data.name} BACKUP`,
          body: `THIS IS A BACKUP
            ${oldRelease.data.body}`
        });

        await github.git.updateRef({
          owner,
          repo,
          ref: `tags/${backupTag}`,
          sha: backupReleaseSha,
          force: true
        });
      } else {
        await github.repos.deleteRelease({
          owner,
          repo,
          release_id: oldRelease.data.id
        });
      }

      // Delete `tag` tag
      await github.git.deleteRef({
        owner,
        repo,
        ref: `tags/${tag}`
      });
    } catch (e) {
      // Do nothing
    }

    // Create a release
    // API Documentation: https://developer.github.com/v3/repos/releases/#create-a-release
    // Octokit Documentation: https://octokit.github.io/rest.js/#octokit-routes-repos-create-release
    const createReleaseResponse = await github.repos.createRelease({
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

    // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    core.setOutput('id', releaseId);
    core.setOutput('html_url', htmlUrl);
    core.setOutput('upload_url', uploadUrl);
  } catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = run;
