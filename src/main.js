import * as core from '@actions/core';
import * as github from '@actions/github';
import {Context} from '@actions/github/lib/context';
import {sync as commitParser} from 'conventional-commits-parser';
import semverValid from 'semver/functions/valid';
import semverRcompare from 'semver/functions/rcompare';
import semverLt from 'semver/functions/lt';
import defaultChangelogOpts from 'conventional-changelog-angular/conventional-recommended-bump';

const ConventionalCommitTypes = {
	feat: 'Features',
	fix: 'Bug Fixes',
	docs: 'Documentation',
	style: 'Styles',
	refactor: 'Code Refactoring',
	perf: 'Performance Improvements',
	test: 'Tests',
	build: 'Builds',
	ci: 'Continuous Integration',
	chore: 'Chores',
	revert: 'Reverts'
}

const getArgs = () => {

	const args = {
		repoToken: core.getInput('repo_token', { required: true }),
		draftRelease: JSON.parse(core.getInput('draft', { required: false })),
		preRelease: JSON.parse(core.getInput('prerelease', { required: false })),
		filterRegex: core.getInput('filter', { required: false }),
		strict: JSON.parse(core.getInput('strict', { required: false }))
	};
	
	return args;

};

const getShortSHA = (sha) => {
	const coreAbbrev = 7;
	return sha.substring(0, coreAbbrev);
};

const octokitLogger = (...args) => {

	return args

		.map((arg) => {

			if (typeof arg === 'string') {
				return arg;
			}
	
			const argCopy = {...arg};
	
			if (argCopy.file) {
				argCopy.file = '== raw file buffer info removed ==';
			}

			if (argCopy.data) {
				argCopy.data = '== raw file buffer info removed ==';
			}
	
			return JSON.stringify(argCopy);

		})
		.reduce((acc, val) => `${acc} ${val}`, '');

};

const parseGitTag = (inputRef) => {
	const re = /^(refs\/)?tags\/(.*)$/;
	const resMatch = inputRef.match(re);
	if (!resMatch || !resMatch[2]) {
		core.debug(`Input "${inputRef}" does not appear to be a tag`);
		return '';
	}
	return resMatch[2];
};

const searchForPreviousReleaseTag = async (client, currentReleaseTag, tagInfo) => {

	const validSemver = semverValid(currentReleaseTag);

	if (!validSemver) {
		throw new Error(`The current tag "${currentReleaseTag}" does not appear to conform to semantic versioning.`);
	}

	const listTagsOptions = client.repos.listTags.endpoint.merge(tagInfo);
	const tl = await client.paginate(listTagsOptions);
	const tagList = tl
		.map((tag) => {
			core.debug(`Currently processing tag ${tag.name}`);
			const t = semverValid(tag.name);
			return {
				...tag,
				semverTag: t,
			};
		})
		.filter((tag) => tag.semverTag !== null)
		.sort((a, b) => semverRcompare(a.semverTag, b.semverTag));

	let previousReleaseTag = '';

	for (const tag of tagList) {
		if (semverLt(tag.semverTag, currentReleaseTag)) {
			previousReleaseTag = tag.name;
			break;
		}
	}

	return previousReleaseTag;

};

const getCommitsSinceRelease = async (client, tagInfo, currentSha) => {

	core.startGroup('Retrieving commit history');

	let resp;
  
	core.info('Determining state of the previous release');

	let previousReleaseRef = '';

	core.info(`Searching for SHA corresponding to previous "${tagInfo.ref}" release tag`);

	try {
		resp = await client.git.getRef(tagInfo);
		previousReleaseRef = parseGitTag(tagInfo.ref);
	} catch (err) {
		core.info(`Could not find SHA corresponding to tag "${tagInfo.ref}" (${err.message}). Assuming this is the first release.`);
		previousReleaseRef = 'HEAD';
	}

	core.info(`Retrieving commits between ${previousReleaseRef} and ${currentSha}`);

	try {

		resp = await client.repos.compareCommits({
			owner: tagInfo.owner,
			repo: tagInfo.repo,
			base: previousReleaseRef,
			head: currentSha
		});

		core.info(`Successfully retrieved ${resp.data.commits.length} commits between ${previousReleaseRef} and ${currentSha}`);
	
	} catch (err) {

		core.warning(`Could not find any commits between ${previousReleaseRef} and ${currentSha}`);
	
	}

	var commits = [];

	try {
		if (resp.data.commits) {
			commits = resp.data.commits;
		}
	} catch (e) {}
	
	core.info(`Currently ${commits.length} number of commits between ${previousReleaseRef} and ${currentSha}`);
	core.endGroup();

	return commits;

};

const isBreakingChange = ({body, footer}) => {
	const re = /^BREAKING\s+CHANGES?:\s+/;
	return re.test(body || '') || re.test(footer || '');
};

const getFormattedChangelogEntry = (parsedCommit) => {

	let entry = '';

	const url = parsedCommit.extra.commit.html_url;
	const sha = getShortSHA(parsedCommit.extra.commit.sha);

	if (parsedCommit.type) {
		const scopeStr = parsedCommit.scope ? `**${parsedCommit.scope}**: ` : '';
		entry = `- ${scopeStr}${parsedCommit.subject} ([${sha}](${url}))`;
	}

	return entry;

};

const getChangelogOptions = async () => {
	const defaultOpts = defaultChangelogOpts;
	defaultOpts['mergePattern'] = '^Merge pull request #(.*) from (.*)$';
	defaultOpts['mergeCorrespondence'] = ['issueId', 'source'];
	core.debug(`Changelog options: ${JSON.stringify(defaultOpts)}`);
	return defaultOpts;
};

const generateChangelogFromParsedCommits = (parsedCommits, args) => {

	let changelog = '';

	// Breaking Changes
	const breaking = parsedCommits
		.filter((val) => val.extra.breakingChange === true)
		.map((val) => getFormattedChangelogEntry(val))
		.reduce((acc, line) => `${acc}\n${line}`, '');

	if (breaking) {
		changelog += '## Breaking Changes\n';
		changelog += breaking.trim();
	}
  
	for (const key of Object.keys(ConventionalCommitTypes)) {
		const clBlock = parsedCommits
			.filter((val) => val.type === key)
			.map((val) => getFormattedChangelogEntry(val))
			.reduce((acc, line) => `${acc}\n${line}`, '');
		if (clBlock) {
			changelog += `\n\n## ${ConventionalCommitTypes[key]}\n`;
			changelog += clBlock.trim();
		}
	}

	// Commits
	if (!args.strict) {

		const commits = parsedCommits
			.filter((val) => val.type === null || Object.keys(ConventionalCommitTypes).indexOf(val.type) === -1)
			.map((val) => getFormattedChangelogEntry(val))
			.reduce((acc, line) => `${acc}\n${line}`, '');

		if (commits) {
			changelog += '\n\n## Commits\n';
			changelog += commits.trim();
		}

	}

	return changelog.trim();

};


const getChangelog = async (commits, args) => {

	const parsedCommits = [];

	core.startGroup('Generating changelog');

	const regex = new RegExp(args.filterRegex, 'gim');

	commits = commits.filter((commit) => commit.commit.message.match(regex) !== null);

	for (const commit of commits) {

		core.debug(`Processing commit: ${JSON.stringify(commit)}`);

		const clOptions = await getChangelogOptions();
		const parsedCommitMsg = commitParser(commit.commit.message, clOptions);
	
		parsedCommitMsg.extra = {
			commit: commit,
			pullRequests: [],
			breakingChange: false
		};

		parsedCommitMsg.extra.breakingChange = isBreakingChange({
			body: parsedCommitMsg.body,
			footer: parsedCommitMsg.footer,
		});

		core.debug(`Parsed commit: ${JSON.stringify(parsedCommitMsg)}`);
		parsedCommits.push(parsedCommitMsg);
		core.info(`Adding commit "${parsedCommitMsg.header}" to the changelog`);

	}

	const changelog = generateChangelogFromParsedCommits(parsedCommits, args);

	core.debug('Changelog:');
	core.debug(changelog);

	core.endGroup();

	return changelog;

};

const generateNewGitHubRelease = async (client, releaseInfo) => {
	core.startGroup(`Generating new GitHub release for the "${releaseInfo.tag_name}" tag`);
	core.info('Creating new release');
	const resp = await client.repos.createRelease(releaseInfo);
	core.endGroup();
	return resp.data.upload_url;
};

const main = async () => {

	try {

		const args = getArgs();
		const context = new Context();	  
		const client = new github.GitHub(args.repoToken, {
			log: {
				debug: (...logArgs) => core.debug(octokitLogger(...logArgs)),
				info: (...logArgs) => core.debug(octokitLogger(...logArgs)),
				warn: (...logArgs) => core.warning(octokitLogger(...logArgs)),
				error: (...logArgs) => core.error(octokitLogger(...logArgs)),
			},
		});
	
		core.startGroup('Determining release tags');

		const releaseTag = parseGitTag(context.ref);

		if (!releaseTag) {
			throw new Error(`This does not appear to be a GitHub tag event. (Event: ${context.ref})`);
		}

		const previousReleaseTag = await searchForPreviousReleaseTag(client, releaseTag, {
			owner: context.repo.owner,
			repo: context.repo.repo,
		});

		core.endGroup();

		const commitsSinceRelease = await getCommitsSinceRelease(
			client, {
				owner: context.repo.owner,
				repo: context.repo.repo,
				ref: `tags/${previousReleaseTag}`,
			}, context.sha
		);

		const changelog = await getChangelog(commitsSinceRelease, args);

		const releaseUploadUrl = await generateNewGitHubRelease(client, {
			owner: context.repo.owner,
			repo: context.repo.repo,
			tag_name: releaseTag,
			name: releaseTag,
			draft: args.draftRelease,
			prerelease: args.preRelease,
			body: changelog
		});

		core.debug(`Exporting environment variable AUTOMATIC_RELEASES_TAG with value ${releaseTag}`);
		core.exportVariable('AUTOMATIC_RELEASES_TAG', releaseTag);
		core.setOutput('automatic_releases_tag', releaseTag);
		core.setOutput('upload_url', releaseUploadUrl);

	} catch (error) {

		core.setFailed(error.message);
		throw error;

	}

};

main();