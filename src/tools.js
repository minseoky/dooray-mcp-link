// Tool definitions and their handlers.

import {
  objectSchema,
  stringSchema,
  numberSchema,
  booleanSchema,
  enumSchema,
  CONFIRM_DESCRIPTION,
} from "./schema.js";

// Tools that change Dooray state. They are hidden in read-only mode, and they
// require an explicit confirmation on every call.
export const WRITE_TOOL_NAMES = new Set([
  "dooray_messenger",
  "dooray_calendar_post_event",
  "dooray_post_log_create",
  "dooray_post_log_update",
]);

export function toolDefinitions() {
  return [
    {
      name: "dooray_messenger",
      description: "send message to dooray messenger",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["send"], "The operation to perform"),
          to: stringSchema("recipient organizationMemberId"),
          message: stringSchema("message to send"),
          confirm: booleanSchema(CONFIRM_DESCRIPTION),
        },
        ["operation", "to", "message", "confirm"],
      ),
    },
    {
      name: "dooray_calendar_calendars",
      description: "find dooray calendars",
      inputSchema: objectSchema(
        { operation: enumSchema(["find_calendars"], "The operation to perform") },
        ["operation"],
      ),
    },
    {
      name: "dooray_calendar_events",
      description: "find dooray events of calendars",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["find_events"], "The operation to perform"),
          calendars: stringSchema("calendar ids separated by commas"),
          timeMin: stringSchema(
            "inclusive start time in ISO 8601, e.g. 2025-04-11T00:00:00+09:00",
          ),
          timeMax: stringSchema(
            "exclusive end time in ISO 8601, e.g. 2025-04-12T00:00:00+09:00",
          ),
        },
        ["operation", "timeMin", "timeMax"],
      ),
    },
    {
      name: "dooray_calendar_post_event",
      description: "register dooray events on a calendar",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["create_event"], "The operation to perform"),
          calendarId: stringSchema("calendar id to register an event"),
          subject: stringSchema("event subject"),
          content: stringSchema("event content"),
          startedAt: stringSchema("event start time in ISO 8601"),
          endedAt: stringSchema("event end time in ISO 8601"),
          wholeDayFlag: booleanSchema("set true for whole day event"),
          recurrenceFrequency: enumSchema(
            ["", "daily", "weekly", "monthly", "yearly"],
            "recurrence frequency",
          ),
          recurrenceInterval: numberSchema("recurrence interval, default is 1"),
          recurrenceUntil: stringSchema("recurrence end date in ISO 8601"),
          recurrenceByday: stringSchema("recurrence by day, e.g. MO,TU,WE"),
          recurrenceBymonth: stringSchema("recurrence by month, 1-12"),
          recurrenceBymonthday: stringSchema(
            "recurrence by day of month, 1-31",
          ),
          recurrenceTimezoneName: stringSchema(
            "timezone for recurrence rule, default Asia/Seoul",
          ),
          confirm: booleanSchema(CONFIRM_DESCRIPTION),
        },
        [
          "operation",
          "subject",
          "content",
          "startedAt",
          "endedAt",
          "confirm",
        ],
      ),
    },
    {
      name: "dooray_account_members",
      description: "find dooray account members by name or userCode",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["find_member_id"], "The operation to perform"),
          member_name: stringSchema("member name"),
          user_code: stringSchema("user code"),
        },
        ["operation", "member_name"],
      ),
    },
    {
      name: "dooray_account_member",
      description: "find dooray account members by id",
      inputSchema: objectSchema(
        {
          operation: enumSchema(
            ["find_member_details"],
            "The operation to perform",
          ),
          member_id: stringSchema("member id"),
        },
        ["operation", "member_id"],
      ),
    },
    {
      name: "dooray_project",
      description: [
        "List Dooray projects accessible to the token or get one project by ID.",
        "A /task/{projectId}/{postId} URL provides projectId directly, while a legacy /project/tasks/{postId} URL contains only postId and requires project discovery.",
        "find_projects requires type, scope, and state; use page and size to exhaust every relevant filter combination because one page is not proof that a project or post is inaccessible.",
        "find_project requires projectId.",
      ].join(" "),
      inputSchema: objectSchema(
        {
          operation: enumSchema(
            ["find_projects", "find_project"],
            "The operation to perform",
          ),
          projectId: stringSchema("project id; required for find_project"),
          type: enumSchema(
            ["public", "private"],
            "project type; required for find_projects",
          ),
          state: enumSchema(
            ["active", "archived"],
            "project state; required for find_projects",
          ),
          scope: enumSchema(
            ["private", "public"],
            "project scope; required for find_projects",
          ),
          page: numberSchema("project list page number; default is 0"),
          size: numberSchema(
            "number of projects per page; default is 100, max is 100",
          ),
        },
        ["operation"],
      ),
    },
    {
      name: "dooray_posts",
      description: [
        "Find Dooray task posts in one project or a comma-separated set of accessible project IDs.",
        "Parse the URL first: /task/{projectId}/{postId} provides both IDs, while legacy /project/tasks/{postId} provides only postId and requires project discovery with dooray_project.",
        "Query the known or candidate project IDs with size up to 100 and continue through pages until the returned post ID matches; a lookup under one wrong project ID or only the first page does not prove that the post is unavailable.",
        "The matching post response contains the task body, so do not call dooray_post_logs unless comments or activity were explicitly requested.",
        "When the post has fileIdList, treat every ID as a downloadable body file, commonly an inline image, and call dooray_post_file_download with the same verified projectId and postId.",
        "Always try that direct download even if dooray_post_files is empty or returns AUTH_FORBIDDEN_ERROR.",
      ].join(" "),
      inputSchema: objectSchema(
        {
          operation: enumSchema(["find_posts"], "The operation to perform"),
          projectId: stringSchema(
            "project id from /task/{projectId}/{postId}, or comma separated accessible project ids discovered for a legacy /project/tasks/{postId} URL",
          ),
          page: numberSchema("page number, default is 0"),
          size: numberSchema(
            "number of posts per page, default is 20, max is 100",
          ),
          fromEmailAddress: stringSchema("filter posts by sender email address"),
          fromMemberIds: stringSchema(
            "filter posts by creator member ids, comma separated",
          ),
          toMemberIds: stringSchema(
            "filter posts by assignee member ids, comma separated",
          ),
          toMemberSize: numberSchema("filter by number of assignees"),
          ccMemberIds: stringSchema(
            "filter posts by cc member ids, comma separated",
          ),
          tagIds: stringSchema("filter posts by tag ids, comma separated"),
          parentPostId: stringSchema("filter sub-tasks of a parent post"),
          postNumber: stringSchema("filter by post number"),
          postWorkflowClasses: stringSchema(
            "backlog, registered, working, closed",
          ),
          postWorkflowIds: stringSchema(
            "filter by workflow ids, comma separated",
          ),
          milestoneIds: stringSchema(
            "filter by milestone ids, comma separated",
          ),
          subjects: stringSchema("filter by post subject keyword"),
          createdAt: stringSchema(
            "date filter: today, thisweek, prev-{N}d, next-{N}d, or ISO8601~ISO8601",
          ),
          updatedAt: stringSchema(
            "date filter: today, thisweek, prev-{N}d, next-{N}d, or ISO8601~ISO8601",
          ),
          dueAt: stringSchema(
            "date filter: today, thisweek, prev-{N}d, next-{N}d, or ISO8601~ISO8601",
          ),
          order: stringSchema(
            "sort order: postDueAt, postUpdatedAt, createdAt, prefix '-' for descending",
          ),
        },
        ["operation", "projectId"],
      ),
    },
    {
      name: "dooray_post_logs",
      description: "find comments and activity logs of a Dooray post",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["find_logs"], "The operation to perform"),
          projectId: stringSchema("project id"),
          postId: stringSchema("post id"),
          page: numberSchema("page number, default is 0"),
          size: numberSchema("number of logs per page, default is 20"),
          order: enumSchema(["createdAt", "-createdAt"], "log sort order"),
        },
        ["operation", "projectId", "postId"],
      ),
    },
    {
      name: "dooray_post_log",
      description: "find a specific comment or activity log of a Dooray post",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["find_log"], "The operation to perform"),
          projectId: stringSchema("project id"),
          postId: stringSchema("post id"),
          logId: stringSchema("log id, or comment id"),
        },
        ["operation", "projectId", "postId", "logId"],
      ),
    },
    {
      name: "dooray_post_log_create",
      description: "add a comment to a Dooray post",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["create_log"], "The operation to perform"),
          projectId: stringSchema("project id"),
          postId: stringSchema("post id"),
          body: objectSchema(
            {
              mimeType: enumSchema(
                ["text/x-markdown"],
                "comment body MIME type",
              ),
              content: stringSchema("comment content"),
            },
            ["mimeType", "content"],
          ),
          confirm: booleanSchema(CONFIRM_DESCRIPTION),
        },
        ["operation", "projectId", "postId", "body", "confirm"],
      ),
    },
    {
      name: "dooray_post_log_update",
      description: "update a comment or activity log of a Dooray post",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["update_log"], "The operation to perform"),
          projectId: stringSchema("project id"),
          postId: stringSchema("post id"),
          logId: stringSchema("log id, or comment id"),
          body: objectSchema(
            {
              mimeType: enumSchema(
                ["text/x-markdown"],
                "comment body MIME type",
              ),
              content: stringSchema("updated comment content"),
            },
            ["mimeType", "content"],
          ),
          confirm: booleanSchema(CONFIRM_DESCRIPTION),
        },
        ["operation", "projectId", "postId", "logId", "body", "confirm"],
      ),
    },
    {
      name: "dooray_post_files",
      description:
        "List regular attachments only. This is not an availability check for inline body images in dooray_posts.fileIdList. The endpoint can be empty or return AUTH_FORBIDDEN_ERROR while direct dooray_post_file_download calls still succeed, so never use this result alone to conclude that body files cannot be read.",
      inputSchema: objectSchema(
        {
          operation: enumSchema(["find_files"], "The operation to perform"),
          projectId: stringSchema("project id"),
          postId: stringSchema("post id"),
        },
        ["operation", "projectId", "postId"],
      ),
    },
    {
      name: "dooray_post_file_download",
      description: [
        "Download a Dooray post file by fileId through authenticated redirects to a local temporary directory.",
        "Authorization is forwarded only to the configured API origin and the HTTPS file-api.dooray.com download service; arbitrary redirect origins receive no Dooray token.",
        "Use this for every ID from the matching dooray_posts.fileIdList, including inline body images, with the same verified projectId and postId; it also supports regular attachment file IDs.",
        "dooray_post_files is not a prerequisite, and an empty result or AUTH_FORBIDDEN_ERROR from that separate endpoint does not imply that this direct download will fail.",
        "On success, the result contains filePath, fileName, mimeType, size, and temporary; inspect filePath with an appropriate local image viewer or document parser.",
        "A fetch failure or timeout is transient and must not be reported as a permission denial; retry or report the transport problem separately.",
        "Only report a body file as forbidden or missing when this direct request returns a terminal Dooray response such as 403 or 404 with the verified projectId, postId, and fileId.",
      ].join(" "),
      inputSchema: objectSchema(
        {
          operation: enumSchema(["download"], "The operation to perform"),
          projectId: stringSchema(
            "verified project id of the matching post; for /task/{projectId}/{postId} URLs this is the first numeric path value",
          ),
          postId: stringSchema(
            "matching post id; this is the final numeric path value in both supported task URL forms",
          ),
          fileId: stringSchema(
            "file id from the matching post's fileIdList or regular attachment list",
          ),
          fileName: stringSchema(
            "optional file name used when the response does not provide one",
          ),
        },
        ["operation", "projectId", "postId", "fileId"],
      ),
    },
    {
      name: "os",
      description: "get os time date",
      inputSchema: objectSchema(
        {
          operation: enumSchema(
            ["get_date_time"],
            "The operation to get date time",
          ),
        },
        ["operation"],
      ),
    },
  ];
}

const POST_QUERY_KEYS = [
  "page",
  "size",
  "fromEmailAddress",
  "fromMemberIds",
  "toMemberIds",
  "toMemberSize",
  "ccMemberIds",
  "tagIds",
  "parentPostId",
  "postNumber",
  "postWorkflowClasses",
  "postWorkflowIds",
  "milestoneIds",
  "subjects",
  "createdAt",
  "updatedAt",
  "dueAt",
  "order",
];

/** Builds the handler for every tool, keyed by name. */
export function toolHandlers(client) {
  return {
    async dooray_messenger(input) {
      requireOperation(input, "send");
      requireConfirmation(input);
      return client.request("POST", "/messenger/v1/channels/direct-send", {
        body: {
          text: requireString(input, "message"),
          organizationMemberId: requireString(input, "to"),
        },
      });
    },

    async dooray_calendar_calendars(input) {
      requireOperation(input, "find_calendars");
      return client.request("GET", "/calendar/v1/calendars");
    },

    async dooray_calendar_events(input) {
      requireOperation(input, "find_events");
      return client.request("GET", "/calendar/v1/calendars/*/events", {
        query: {
          calendars: input.calendars,
          timeMin: requireString(input, "timeMin"),
          timeMax: requireString(input, "timeMax"),
        },
      });
    },

    async dooray_calendar_post_event(input) {
      requireOperation(input, "create_event");
      requireConfirmation(input);

      const recurrenceRule = buildRecurrenceRule(input);
      const calendarId = input.calendarId || "*";

      return client.request(
        "POST",
        `/calendar/v1/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          body: {
            users: {},
            subject: requireString(input, "subject"),
            body: {
              mimeType: "text/html",
              content: requireString(input, "content"),
            },
            startedAt: requireString(input, "startedAt"),
            endedAt: requireString(input, "endedAt"),
            wholeDayFlag: Boolean(input.wholeDayFlag),
            location: "",
            ...(recurrenceRule ? { recurrenceRule } : {}),
          },
        },
      );
    },

    async dooray_account_members(input) {
      requireOperation(input, "find_member_id");
      return client.request("GET", "/common/v1/members", {
        query: {
          name: requireString(input, "member_name"),
          userCode: input.user_code,
        },
      });
    },

    async dooray_account_member(input) {
      requireOperation(input, "find_member_details");
      return client.request(
        "GET",
        `/common/v1/members/${encodeURIComponent(requireString(input, "member_id"))}`,
      );
    },

    async dooray_project(input) {
      if (input.operation === "find_project") {
        return client.request(
          "GET",
          `/project/v1/projects/${encodeURIComponent(requireString(input, "projectId"))}`,
        );
      }

      requireOperation(input, "find_projects");
      return client.request("GET", "/project/v1/projects", {
        query: {
          member: "me",
          page: input.page ?? 0,
          size: input.size ?? 100,
          type: requireString(input, "type"),
          scope: requireString(input, "scope"),
          state: requireString(input, "state"),
        },
      });
    },

    async dooray_posts(input) {
      requireOperation(input, "find_posts");
      return client.request(
        "GET",
        `/project/v1/projects/${encodeURIComponent(requireString(input, "projectId"))}/posts`,
        { query: pick(input, POST_QUERY_KEYS) },
      );
    },

    async dooray_post_logs(input) {
      requireOperation(input, "find_logs");
      const { projectId, postId } = postPath(input);
      return client.request(
        "GET",
        `/project/v1/projects/${projectId}/posts/${postId}/logs`,
        { query: pick(input, ["page", "size", "order"]) },
      );
    },

    async dooray_post_log(input) {
      requireOperation(input, "find_log");
      const { projectId, postId } = postPath(input);
      const logId = encodeURIComponent(requireString(input, "logId"));
      return client.request(
        "GET",
        `/project/v1/projects/${projectId}/posts/${postId}/logs/${logId}`,
      );
    },

    async dooray_post_log_create(input) {
      requireOperation(input, "create_log");
      requireConfirmation(input);

      const { projectId, postId } = postPath(input);
      return client.request(
        "POST",
        `/project/v1/projects/${projectId}/posts/${postId}/logs`,
        { body: { body: logBody(input) } },
      );
    },

    async dooray_post_log_update(input) {
      requireOperation(input, "update_log");
      requireConfirmation(input);

      const { projectId, postId } = postPath(input);
      const logId = encodeURIComponent(requireString(input, "logId"));
      return client.request(
        "PUT",
        `/project/v1/projects/${projectId}/posts/${postId}/logs/${logId}`,
        { body: { body: logBody(input) } },
      );
    },

    async dooray_post_files(input) {
      requireOperation(input, "find_files");
      const { projectId, postId } = postPath(input);
      return client.request(
        "GET",
        `/project/v1/projects/${projectId}/posts/${postId}/files`,
      );
    },

    async dooray_post_file_download(input) {
      requireOperation(input, "download");
      const { projectId, postId } = postPath(input);
      const fileId = requireString(input, "fileId");

      const result = await client.download(
        `/project/v1/projects/${projectId}/posts/${postId}/files/${encodeURIComponent(fileId)}?media=raw`,
        input.fileName,
        fileId,
      );
      return JSON.stringify(result);
    },

    async os(input) {
      requireOperation(input, "get_date_time");
      return JSON.stringify({ time: formatLocalDateTime(new Date()) });
    },
  };
}

/** Returns the tools visible in the given mode, paired with their handlers. */
export function buildRegistry(client, readOnly) {
  const handlers = toolHandlers(client);
  const tools = toolDefinitions().filter(
    (tool) => !(readOnly && WRITE_TOOL_NAMES.has(tool.name)),
  );

  const byName = new Map();
  for (const tool of tools) {
    if (handlers[tool.name]) {
      byName.set(tool.name, handlers[tool.name]);
    }
  }

  return { tools, handlers: byName };
}

function requireOperation(input, expected) {
  if (input.operation !== expected) {
    throw new Error(`operation must be ${expected}`);
  }
}

/**
 * Rejects a write call that does not carry an explicit confirm=true. Passing
 * schema validation is not enough for a tool that changes Dooray state, so the
 * caller has to opt in on every single call.
 */
function requireConfirmation(input) {
  if (input.confirm !== true) {
    throw new Error("confirm must be true to execute this write operation");
  }
}

function requireString(input, key) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function postPath(input) {
  return {
    projectId: encodeURIComponent(requireString(input, "projectId")),
    postId: encodeURIComponent(requireString(input, "postId")),
  };
}

function logBody(input) {
  const body = input.body;
  if (!body || typeof body !== "object") {
    throw new Error("body must be an object with mimeType and content");
  }
  return {
    mimeType: requireString(body, "mimeType"),
    content: requireString(body, "content"),
  };
}

function pick(input, keys) {
  const result = {};
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") {
      result[key] = input[key];
    }
  }
  return result;
}

function buildRecurrenceRule(input) {
  if (!input.recurrenceFrequency) {
    return null;
  }

  return {
    frequency: input.recurrenceFrequency,
    interval: Number(input.recurrenceInterval || 1),
    until: input.recurrenceUntil || "",
    byday: input.recurrenceByday || "",
    bymonth: input.recurrenceBymonth || "",
    bymonthday: input.recurrenceBymonthday || "",
    timezoneName: input.recurrenceTimezoneName || "Asia/Seoul",
  };
}

function formatLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
