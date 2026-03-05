# Contributing to NemoClaw Community

Thank you for your interest in contributing to the NemoClaw Community ecosystem. This guide covers everything you need to get started.

## Ways to Contribute

- **Sandbox images** -- Add new domain-specific sandbox environments under `sandboxes/`
- **Skills** -- Create agent skills and tool definitions inside a sandbox's `skills/` directory
- **Bug fixes** -- Fix issues in existing sandboxes, skills, or configurations
- **Documentation** -- Improve READMEs, guides, and usage examples
- **Integrations** -- Connect NemoClaw to new tools, platforms, or workflows

## Developer Certificate of Origin (DCO)

All contributions to this project must include a `Signed-off-by` line in the commit message, certifying that you wrote or have the right to submit the code under the project's open-source license. This is the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).

Add the sign-off automatically with `git commit -s`:

```bash
git commit -s -m "Add new sandbox image"
```

This appends a line like:

```
Signed-off-by: Your Name <your.email@example.com>
```

A DCO check runs on every pull request and will fail if any commit is missing the sign-off.

## Getting Started

1. Fork this repository
2. Clone your fork locally
3. Create a feature branch from `main`

```bash
git clone https://github.com/<your-username>/NemoClaw-Community.git
cd NemoClaw-Community
git checkout -b my-feature
```

## Adding a Sandbox Image

Each sandbox lives in its own directory under `sandboxes/`:

```
sandboxes/my-sandbox/
  Dockerfile
  README.md
  ...
```

Requirements:
- A `Dockerfile` that builds cleanly
- A `README.md` describing the sandbox's purpose, usage, and any prerequisites
- Keep images minimal -- only include what's needed for the workload

## Adding a Skill

Skills live inside their sandbox's `skills/` directory (e.g., `sandboxes/openclaw/skills/my-skill/`). Each skill should include:
- A `SKILL.md` describing what it does and when to use it
- Any supporting files the skill needs
- A README with usage examples

## Submitting a Pull Request

1. Ensure your changes are focused -- one feature or fix per PR
2. Include a clear description of what your PR does and why
3. Test your changes locally before submitting
4. Update any relevant documentation

## Development Guidelines

- Follow existing naming conventions and directory structures
- Write clear commit messages
- Keep PRs small and reviewable
- Respond to review feedback promptly

## Reporting Issues

Use GitHub Issues for bug reports and feature requests. Include:
- A clear title and description
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Environment details (OS, Docker version, GPU, etc.)

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
