# Release Notes GitHub Action

This GitHub action creates a release with a simple changelog when a tag is pushed and is based on the [Automatic Releases](https://github.com/marvinpinto/action-automatic-releases) action. The changelog is generated out of commits between the current and the latest tag. Commits can optionally be filtered by a regex pattern to only include matching messages. Commit messages are parsed following the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

## Usage 

A workflow using this actions looks as follows:

    name: "release-notes"

    on:
      push:
        tags:
          - "*"
    
    jobs:
      tagged-release:
        name: "Filtered Release Notes"
        runs-on: "ubuntu-latest"
        steps:
          - uses: "marcantondahmen/release-notes-action@0.1.0"
            with:
              repo_token: "${{ secrets.GITHUB_TOKEN }}"
              prerelease: false
              draft: false
              filter: "^(feat|fix)"
              strict: false

## Options

The following options are available to configure a workflow.

| Name | Description |
| --- | --- |
| repo_token | GitHub secret token (required) |
| draft | Release should be a draft only |
| prerelease | Release is a pre-release |
| filter | Filter the included commit messages by a given regex |
| strict | Only include commit messages that follow the conventional commits scheme |
