# Project Databricks defaults

The user explicitly selected `fevm-serverless-stable-prvwqx` as the default Databricks profile for this entire project.

- Workspace: `https://fevm-serverless-stable-prvwqx.cloud.databricks.com`.
- Use `--profile fevm-serverless-stable-prvwqx` for Databricks CLI commands in this project.
- Use `DATABRICKS_CONFIG_PROFILE=fevm-serverless-stable-prvwqx` for AppKit, SDKs, and other tools that resolve credentials through the environment.
- This is an explicit, persistent user selection. Do not ask the user to select or reconfirm this profile again unless they request another workspace or the configured profile no longer matches this workspace.
- Keep this default scoped to the project; do not modify the global Databricks `DEFAULT` profile.

Follow the existing task's resource and deployment requirements separately. Selecting this profile does not select or create a Lakebase project or Genie space.
