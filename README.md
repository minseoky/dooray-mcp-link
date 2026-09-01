# dooray-mcp-link

Dooray MCP server in pure JavaScript. It exposes Dooray's account, calendar, project, post, attachment, and messenger APIs to MCP clients such as Claude Desktop.

The package ships no compiled executable. Node runs the JavaScript directly, so nothing is unpacked, written, or launched as a binary on the machine.

## Requirements

- Node.js 18 or newer
- A Dooray personal API token

No other dependencies: the server uses only the Node standard library.

## Official documentation

- [Dooray API official documentation](https://helpdesk.dooray.com/share/pages/9wWo-xwiR66BO5LGshgVTg/2939987729788437786)

## Install

One command registers the server with Claude Desktop:

```sh
npx -y --package=dooray-mcp-link -- dooray-mcp-link register --token "{personal-token}" --force
```

Then restart Claude Desktop.

The spec goes through `--package`, with the executable named after `--`. Windows npx reads a bare `dooray-mcp-link@1.2.3` as the command to run and fails with "is not recognized as an internal or external command"; this form works on both platforms, and `register` writes it into the configuration for the same reason.

Registering read-only, so no tool can write back to Dooray:

```sh
npx -y --package=dooray-mcp-link -- dooray-mcp-link register --token "{personal-token}" --mode read-only --force
```

## Run

```sh
DOORAY_TOKEN="{personal-token}" npx -y --package=dooray-mcp-link -- dooray-mcp-link
```

## What `register` does

- Searches the known Claude Desktop configuration locations and merges into the file that already exists, rather than assuming one path. On Windows that includes the packaged-install location under `LOCALAPPDATA\Packages\`, where a Store or MSIX install has its `Roaming` writes redirected.
- Prints the file it wrote, so the location can be confirmed. If no configuration existed anywhere it searched, it says so and lists the locations, because that is also what happens when an install keeps its configuration somewhere else. Use `--config <path>` to point at that file directly.
- Copies the current file to `claude_desktop_config.json.bak` before writing, and writes through a temporary file so a failure cannot truncate the configuration.
- Merges only the `mcpServers.<name>` entry, leaving every other server and top-level setting untouched.
- Refuses to overwrite an existing server of the same name unless `--force` is passed.
- Writes a new configuration owner-only (`0600`), because the file holds the API token.

Preview the JSON without touching the file:

```sh
npx -y --package=dooray-mcp-link -- dooray-mcp-link register --print --token "{personal-token}"
```

`register --help` lists every option, including `--name <name>` to register a second server alongside the first and `--command <path>` to record a specific executable.

### If Claude Desktop does not pick it up

Check that the file `register` reported is the one Claude Desktop actually reads. Its settings dialog exposes the configuration through "Edit Config", which reveals the path in use on that machine. Re-run with `--config <path>` if they differ.

## Manual configuration

```json
{
  "mcpServers": {
    "dooray": {
      "command": "npx",
      "args": ["-y", "--package=dooray-mcp-link", "--", "dooray-mcp-link"],
      "env": {
        "DOORAY_TOKEN": "{personal-token}"
      }
    }
  }
}
```

## Claude Code

```sh
claude mcp add dooray --env DOORAY_TOKEN="{personal-token}" -- npx -y --package=dooray-mcp-link -- dooray-mcp-link
```

## What the MCP client receives

Every tool returns the Dooray API response as-is. A task body, comment, calendar entry, or member record is passed to the MCP client unchanged, and from there to whatever model backs it — including anything the original Dooray content happens to contain, such as personal data or material your organization classifies as confidential.

The server does not classify, redact, or filter that content, and it cannot tell which posts are sensitive. Deciding what may leave Dooray is the caller's responsibility:

- Scope requests to the projects and posts that actually need to be read, rather than sweeping whole projects.
- Treat `dooray_post_file_download` the same way. It writes attachments, including inline body images, to a local temporary directory that is not cleaned up automatically.
- Run with `--mode read-only` when a session only needs to read, so no tool can write back to Dooray.
- Check your organization's policy before pointing this at projects holding personal or confidential data.

## Write tools require confirmation

The four write-capable tools — `dooray_messenger`, `dooray_calendar_post_event`, `dooray_post_log_create`, and `dooray_post_log_update` — take a required `confirm` boolean. The handler refuses the call unless it is exactly `true`, before any request reaches Dooray, so passing schema validation is not on its own enough to send a message or post a comment. Set it only after the user has confirmed the specific change.

## Read-only mode

Dooray personal API tokens are not issued with separate read-only and write permissions. A token that can call write APIs still has those permissions at the Dooray API level.

For safer installations, this server provides a read-only mode at the MCP tool layer. With `--mode read-only` or `DOORAY_MCP_MODE=read-only`, write-capable tools are not exposed in `tools/list` and cannot be called through `tools/call`.

Exposed in read-only mode:

- `dooray_calendar_calendars`
- `dooray_calendar_events`
- `dooray_account_members`
- `dooray_account_member`
- `dooray_project`
- `dooray_posts`
- `dooray_post_logs`
- `dooray_post_log`
- `dooray_post_files`
- `dooray_post_file_download`
- `os`

Hidden in read-only mode:

- `dooray_messenger`
- `dooray_calendar_post_event`
- `dooray_post_log_create`
- `dooray_post_log_update`

## Attachment downloads

`dooray_post_file_download` follows Dooray's redirects itself rather than letting the HTTP client do it, so it can decide where the token may go. The `Authorization` header is sent only to the configured API origin and to the HTTPS `file-api.dooray.com` download service; any other redirect target receives no credentials.

Downloaded names are stripped of directory components and of the characters Windows rejects (`\ / : * ? " < > |`, control characters, and trailing dots or spaces), so a name chosen by the server cannot escape the download directory.

## Scope

This server does not wrap every Dooray API. It focuses on frequently used account, calendar, project, post, attachment, and messenger endpoints.

Most `/admin/v1` and `/admin/v2` administration APIs are intentionally not exposed, especially write-capable administration endpoints.

## Tools

- `dooray_messenger` (`confirm` must be `true`)
- `dooray_calendar_calendars`
- `dooray_calendar_events`
- `dooray_calendar_post_event` (`confirm` must be `true`)
- `dooray_account_members`
- `dooray_account_member`
- `dooray_project`
- `dooray_posts` (finds task posts and exposes the task body plus `fileIdList`, which can contain inline body images/files)
- `dooray_post_logs` (find comments and activity logs for a post)
- `dooray_post_log` (find one comment or activity log by ID)
- `dooray_post_log_create` (add a comment; body is `{ "mimeType": "text/x-markdown", "content": "..." }`, and `confirm` must be `true`)
- `dooray_post_log_update` (update a comment or activity log, same body format, `confirm` must be `true`)
- `dooray_post_files` (lists regular attachments; an empty result or `AUTH_FORBIDDEN_ERROR` does not determine whether `fileIdList` items can be downloaded)
- `dooray_post_file_download` (downloads IDs from `dooray_posts.fileIdList`, including inline body images, or regular attachment file IDs)
- `os`

### Reading task URLs and body files

Use this workflow when a request asks for a Dooray task body, an image embedded in the body, or a file referenced by the body. Comments and activity logs are a separate resource and are not required.

1. Parse the task URL. `/task/{projectId}/{postId}` provides both IDs directly. The legacy `/project/tasks/{postId}` form provides only `postId`, so its trailing number must not be used as `projectId`.
2. Resolve the project only for the legacy URL form. Call `dooray_project` with `operation=find_projects` and the required `type`, `scope`, and `state` filters. Repeat the relevant filter combinations and continue through `page` values with `size` up to `100` until every result page has been checked.
3. Search for the matching post with `dooray_posts`, using the project ID from the new URL form or the candidate IDs discovered for a legacy URL. A lookup under one incorrect project ID, or only the first result page, is not evidence that the task is unavailable.
4. Read the task body from the matching result. Do not call `dooray_post_logs` unless comments or activity history were explicitly requested.
5. If the matching post contains `fileIdList`, call `dooray_post_file_download` once for every listed ID using the same verified `projectId` and `postId`.
6. Inspect the returned local `filePath` with an image viewer or an appropriate document parser. The result also includes `fileName`, `mimeType`, `size`, and `temporary`.

`dooray_post_files` lists regular attachments, which is a separate path from the `fileIdList` body files. It can return an empty list or `AUTH_FORBIDDEN_ERROR` even when direct downloads succeed, so neither outcome proves a body file is inaccessible. A transport failure or timeout is likewise not a permission result. Report a file as forbidden or missing only when the direct download returns a terminal response such as `403` or `404` with the verified IDs.

## Options

- `--token`: Dooray personal API token. Defaults to `DOORAY_TOKEN`.
- `--endpoint`: Dooray API endpoint. Defaults to `DOORAY_ENDPOINT`, then `https://api.dooray.com`.
- `--mode`: tool exposure mode, `full` or `read-only`. Defaults to `DOORAY_MCP_MODE` or `full`.
- `--help`: print usage and exit.

## Subcommands

- `register`: merge this server into the Claude Desktop configuration. See [What `register` does](#what-register-does).

## Environment

- `DOORAY_TOKEN`: Dooray personal API token.
- `DOORAY_ENDPOINT`: Dooray API endpoint, default `https://api.dooray.com`.
- `DOORAY_MCP_MODE`: `full` or `read-only`, default `full`.
- `DOORAY_REQUEST_TIMEOUT_MS`: per-request timeout in milliseconds, default `30000`.
- `DOORAY_DOWNLOAD_DIR`: attachment download directory, default `<system temp>/dooray-mcp`.

## Project structure

```text
dooray-mcp-link/
├── src/
│   ├── index.js       # entry point: config, client, registry, stdio server
│   ├── config.js      # flags and environment variables
│   ├── dooray.js      # authenticated API client and attachment download
│   ├── mcp.js         # JSON-RPC 2.0 stdio transport and MCP methods
│   ├── schema.js      # JSON Schema builders
│   ├── tools.js       # tool definitions and handlers
│   └── register.js    # claude_desktop_config.json merging
├── test/
└── package.json
```

## Development

```sh
npm test                                  # node --test, no dependencies
DOORAY_TOKEN="{personal-token}" node ./src/index.js
```

## License

MIT
