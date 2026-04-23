#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.DOCUFLOW_API_URL || "http://localhost:5000";
const API_KEY = process.env.DOCUFLOW_API_KEY || "";

async function apiRequest(
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
  };

  const options: RequestInit = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${method} ${path} failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function extractTextFromTiptap(content: any): string {
  if (!content) return "";
  let text = "";
  function traverse(node: any) {
    if (!node) return;
    if (node.type === "text" && node.text) {
      text += node.text + " ";
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }
  traverse(content);
  return text.trim();
}

const server = new McpServer({
  name: "docuflow",
  version: "1.0.0",
});

function safeTool(
  name: string,
  config: { description: string; inputSchema: Record<string, any> },
  handler: (args: any) => Promise<any>
) {
  server.registerTool(name, config, async (args: any) => {
    try {
      return await handler(args);
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error in ${name}: ${error.message || String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });
}


safeTool(
  "list_projects",
  {
    description:
      "List all documentation projects. Returns project names, descriptions, and IDs.",
    inputSchema: {},
  },
  async () => {
    const projects = await apiRequest("GET", "/api/projects");
    const formatted = projects
      .map(
        (p: any) =>
          `- ${p.name} (ID: ${p.id})\n  Description: ${p.description || "None"}`
      )
      .join("\n");
    return {
      content: [{ type: "text", text: formatted || "No projects found." }],
    };
  }
);

safeTool(
  "get_project",
  {
    description: "Get details of a specific project by ID.",
    inputSchema: {
      projectId: z.string().describe("The project UUID"),
    },
  },
  async ({ projectId }) => {
    const project = await apiRequest("GET", `/api/projects/${projectId}`);
    return {
      content: [
        {
          type: "text",
          text: `Project: ${project.name}\nDescription: ${project.description || "None"}\nCreated: ${project.createdAt}\nOwner ID: ${project.ownerId}`,
        },
      ],
    };
  }
);

safeTool(
  "list_documents",
  {
    description:
      "List all documents/pages within a project. Returns document titles, IDs, and hierarchy.",
    inputSchema: {
      projectId: z.string().describe("The project UUID"),
    },
  },
  async ({ projectId }) => {
    const docs = await apiRequest(
      "GET",
      `/api/projects/${projectId}/documents`
    );
    function formatDoc(doc: any, indent: number = 0): string {
      const prefix = "  ".repeat(indent);
      let line = `${prefix}- ${doc.title || "Untitled"} (ID: ${doc.id})`;
      if (doc.children && doc.children.length > 0) {
        line +=
          "\n" +
          doc.children.map((c: any) => formatDoc(c, indent + 1)).join("\n");
      }
      return line;
    }
    const formatted = docs.map((d: any) => formatDoc(d)).join("\n");
    return {
      content: [
        { type: "text", text: formatted || "No documents in this project." },
      ],
    };
  }
);

safeTool(
  "get_document",
  {
    description:
      "Get the full content of a document/page. Returns the title and readable text content.",
    inputSchema: {
      documentId: z.string().describe("The document UUID"),
    },
  },
  async ({ documentId }) => {
    const doc = await apiRequest("GET", `/api/documents/${documentId}`);
    const textContent = extractTextFromTiptap(doc.content);
    return {
      content: [
        {
          type: "text",
          text: `Title: ${doc.title || "Untitled"}\nProject ID: ${doc.projectId}\nParent ID: ${doc.parentId || "None (root)"}\nLast Updated: ${doc.updatedAt}\n\nContent:\n${textContent || "(Empty document)"}`,
        },
      ],
    };
  }
);

safeTool(
  "create_document",
  {
    description: "Create a new document/page in a project.",
    inputSchema: {
      projectId: z.string().describe("The project UUID"),
      title: z.string().describe("The document title"),
      parentId: z
        .string()
        .optional()
        .describe("Parent document ID for nesting (optional)"),
    },
  },
  async ({ projectId, title, parentId }) => {
    const body: any = { title };
    if (parentId) body.parentId = parentId;
    const doc = await apiRequest(
      "POST",
      `/api/projects/${projectId}/documents`,
      body
    );
    return {
      content: [
        {
          type: "text",
          text: `Created document "${doc.title}" (ID: ${doc.id}) in project ${projectId}`,
        },
      ],
    };
  }
);

safeTool(
  "update_document",
  {
    description: "Update a document's title and/or content.",
    inputSchema: {
      documentId: z.string().describe("The document UUID"),
      title: z.string().optional().describe("New title (optional)"),
      content: z
        .string()
        .optional()
        .describe(
          "New plain text content. Will be converted to a TipTap paragraph. (optional)"
        ),
    },
  },
  async ({ documentId, title, content }) => {
    const body: any = {};
    if (title) body.title = title;
    if (content) {
      body.content = {
        type: "doc",
        content: content.split("\n\n").map((paragraph: string) => ({
          type: "paragraph",
          content: paragraph
            ? [{ type: "text", text: paragraph }]
            : [],
        })),
      };
    }
    const doc = await apiRequest("PATCH", `/api/documents/${documentId}`, body);
    return {
      content: [
        {
          type: "text",
          text: `Updated document "${doc.title}" (ID: ${doc.id})`,
        },
      ],
    };
  }
);

safeTool(
  "search",
  {
    description:
      "Search across all projects and documents by keyword. Returns matching document titles and snippets.",
    inputSchema: {
      query: z.string().describe("The search query text"),
    },
  },
  async ({ query }) => {
    const results = await apiRequest(
      "GET",
      `/api/search?q=${encodeURIComponent(query)}`
    );
    if (!results || results.length === 0) {
      return {
        content: [
          { type: "text", text: `No results found for "${query}".` },
        ],
      };
    }
    const formatted = results
      .map(
        (r: any) =>
          `- ${r.title || "Untitled"} (ID: ${r.id}, Project: ${r.projectId})\n  Match: ${r.snippet || "N/A"}`
      )
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Search results for "${query}":\n\n${formatted}`,
        },
      ],
    };
  }
);


safeTool(
  "list_clients",
  {
    description: "List all CRM clients/companies.",
    inputSchema: {},
  },
  async () => {
    const clients = await apiRequest("GET", "/api/crm/clients");
    const formatted = clients
      .map(
        (c: any) =>
          `- ${c.name} (ID: ${c.id})\n  Company: ${c.company || "N/A"} | Email: ${c.email || "N/A"} | Status: ${c.status || "N/A"}`
      )
      .join("\n");
    return {
      content: [{ type: "text", text: formatted || "No clients found." }],
    };
  }
);

safeTool(
  "get_client",
  {
    description: "Get details of a specific CRM client.",
    inputSchema: {
      clientId: z.string().describe("The client UUID"),
    },
  },
  async ({ clientId }) => {
    const client = await apiRequest("GET", `/api/crm/clients/${clientId}`);
    return {
      content: [
        {
          type: "text",
          text: `Client: ${client.name}\nCompany: ${client.company || "N/A"}\nEmail: ${client.email || "N/A"}\nPhone: ${client.phone || "N/A"}\nStatus: ${client.status || "N/A"}\nSource: ${client.source || "N/A"}\nNotes: ${client.notes || "N/A"}`,
        },
      ],
    };
  }
);

safeTool(
  "list_crm_projects",
  {
    description:
      "List all CRM projects with their status, type, dates, and associated project names.",
    inputSchema: {
      status: z
        .string()
        .optional()
        .describe(
          "Filter by status (e.g. in_negotiation, won_in_progress, completed)"
        ),
    },
  },
  async ({ status }) => {
    let url = "/api/crm/projects";
    if (status) url += `?status=${encodeURIComponent(status)}`;
    const result = await apiRequest("GET", url);
    const projects = result.data || result;
    const formatted = (Array.isArray(projects) ? projects : [])
      .map(
        (p: any) =>
          `- ${p.project?.name || "Unnamed"} (CRM ID: ${p.id})\n  Status: ${p.status} | Type: ${p.projectType}\n  Client: ${p.client?.name || "None"}\n  Start: ${p.startDate || "N/A"} | Due: ${p.dueDate || "N/A"}\n  Budgeted: ${p.budgetedHours || 0}h | Actual: ${p.actualHours || 0}h`
      )
      .join("\n");
    return {
      content: [
        { type: "text", text: formatted || "No CRM projects found." },
      ],
    };
  }
);

safeTool(
  "get_crm_project",
  {
    description: "Get detailed information about a specific CRM project.",
    inputSchema: {
      crmProjectId: z.string().describe("The CRM project UUID"),
    },
  },
  async ({ crmProjectId }) => {
    const p = await apiRequest("GET", `/api/crm/projects/${crmProjectId}`);
    return {
      content: [
        {
          type: "text",
          text: `CRM Project: ${p.project?.name || "Unnamed"}\nStatus: ${p.status}\nType: ${p.projectType}\nClient: ${p.client?.name || "None"}\nAssignee: ${p.assignee ? `${p.assignee.firstName} ${p.assignee.lastName}` : "Unassigned"}\nStart: ${p.startDate || "N/A"}\nDue: ${p.dueDate || "N/A"}\nBudgeted Hours: ${p.budgetedHours || 0}\nActual Hours: ${p.actualHours || 0}\nComments: ${p.comments || "None"}`,
        },
      ],
    };
  }
);


safeTool(
  "list_time_entries",
  {
    description:
      "List time tracking entries. Can filter by project, user, and date range.",
    inputSchema: {
      crmProjectId: z
        .string()
        .optional()
        .describe("Filter by CRM project UUID"),
      startDate: z
        .string()
        .optional()
        .describe("Start date filter (ISO format, e.g. 2026-01-01)"),
      endDate: z
        .string()
        .optional()
        .describe("End date filter (ISO format, e.g. 2026-01-31)"),
    },
  },
  async ({ crmProjectId, startDate, endDate }) => {
    const params = new URLSearchParams();
    if (crmProjectId) params.set("crmProjectId", crmProjectId);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const qs = params.toString();
    const result = await apiRequest(
      "GET",
      `/api/time-tracking/entries${qs ? `?${qs}` : ""}`
    );
    const entries = result.data || result;
    if (!Array.isArray(entries) || entries.length === 0) {
      return {
        content: [{ type: "text", text: "No time entries found." }],
      };
    }
    const formatted = entries
      .map((e: any) => {
        const dur = e.duration || 0;
        const hours = Math.floor(dur / 3600);
        const mins = Math.floor((dur % 3600) / 60);
        return `- ${e.description || "No description"} | ${hours}h ${mins}m | Status: ${e.status}\n  Project: ${e.crmProjectId} | ${e.startTime} → ${e.endTime || "ongoing"}`;
      })
      .join("\n");
    return {
      content: [{ type: "text", text: `Time Entries:\n\n${formatted}` }],
    };
  }
);

safeTool(
  "get_time_tracking_stats",
  {
    description:
      "Get time tracking statistics/summary. Shows total hours, breakdown by project.",
    inputSchema: {
      startDate: z
        .string()
        .optional()
        .describe("Start date (ISO format)"),
      endDate: z
        .string()
        .optional()
        .describe("End date (ISO format)"),
    },
  },
  async ({ startDate, endDate }) => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const qs = params.toString();
    const stats = await apiRequest(
      "GET",
      `/api/time-tracking/stats${qs ? `?${qs}` : ""}`
    );
    return {
      content: [
        {
          type: "text",
          text: `Time Tracking Stats:\n${JSON.stringify(stats, null, 2)}`,
        },
      ],
    };
  }
);

safeTool(
  "start_time_tracking",
  {
    description:
      "Start tracking time on a CRM project. When the workspace uses per-task time tracking, taskId is required (same as the web app).",
    inputSchema: {
      crmProjectId: z.string().describe("The CRM project UUID to track time for"),
      taskId: z
        .string()
        .optional()
        .describe("Task UUID — required if the organisation uses tasks for time entries"),
      description: z
        .string()
        .optional()
        .describe("Description of what you're working on"),
    },
  },
  async ({ crmProjectId, taskId, description }) => {
    const body: any = { crmProjectId };
    if (taskId) body.taskId = taskId;
    if (description) body.description = description;
    const entry = await apiRequest("POST", "/api/time-tracking/start", body);
    return {
      content: [
        {
          type: "text",
          text: `Started time tracking (Entry ID: ${entry.id}) on project ${crmProjectId}${description ? ` - "${description}"` : ""}`,
        },
      ],
    };
  }
);

safeTool(
  "stop_time_tracking",
  {
    description: "Stop the currently active time tracking entry.",
    inputSchema: {
      entryId: z.string().describe("The time entry UUID to stop"),
    },
  },
  async ({ entryId }) => {
    const entry = await apiRequest(
      "POST",
      `/api/time-tracking/${entryId}/stop`
    );
    const dur = entry.duration || 0;
    const hours = Math.floor(dur / 3600);
    const mins = Math.floor((dur % 3600) / 60);
    return {
      content: [
        {
          type: "text",
          text: `Stopped time tracking (Entry ID: ${entry.id}). Total duration: ${hours}h ${mins}m`,
        },
      ],
    };
  }
);

safeTool(
  "get_active_time_entry",
  {
    description:
      "Check if there is a currently active/running time tracking entry.",
    inputSchema: {},
  },
  async () => {
    const entry = await apiRequest("GET", "/api/time-tracking/active");
    if (!entry) {
      return {
        content: [
          { type: "text", text: "No active time tracking entry." },
        ],
      };
    }
    const dur = entry.duration || 0;
    const hours = Math.floor(dur / 3600);
    const mins = Math.floor((dur % 3600) / 60);
    return {
      content: [
        {
          type: "text",
          text: `Active Entry (ID: ${entry.id}):\nProject: ${entry.crmProjectId}\nDescription: ${entry.description || "None"}\nStatus: ${entry.status}\nDuration: ${hours}h ${mins}m\nStarted: ${entry.startTime}`,
        },
      ],
    };
  }
);


safeTool(
  "ask_ai",
  {
    description:
      "Ask the AI assistant a question about your documentation. Uses semantic search across all your projects and documents to find relevant context.",
    inputSchema: {
      question: z.string().describe("Your question about the documentation"),
      projectId: z
        .string()
        .optional()
        .describe("Optionally limit to a specific project UUID"),
    },
  },
  async ({ question, projectId }) => {
    const body: any = {
      message: question,
      conversationHistory: [],
    };
    if (projectId) body.projectId = projectId;
    const result = await apiRequest("POST", "/api/chat", body);
    return {
      content: [
        {
          type: "text",
          text: result.response || result.message || JSON.stringify(result),
        },
      ],
    };
  }
);


safeTool(
  "list_recent_documents",
  {
    description: "Get recently modified documents across all projects.",
    inputSchema: {},
  },
  async () => {
    const docs = await apiRequest("GET", "/api/documents/recent");
    if (!docs || docs.length === 0) {
      return {
        content: [{ type: "text", text: "No recent documents." }],
      };
    }
    const formatted = docs
      .map(
        (d: any) =>
          `- ${d.title || "Untitled"} (ID: ${d.id})\n  Project: ${d.projectId} | Updated: ${d.updatedAt}`
      )
      .join("\n");
    return {
      content: [
        { type: "text", text: `Recent Documents:\n\n${formatted}` },
      ],
    };
  }
);

safeTool(
  "list_users",
  {
    description: "List all users in the system with their roles.",
    inputSchema: {},
  },
  async () => {
    const users = await apiRequest("GET", "/api/admin/users");
    const formatted = (Array.isArray(users) ? users : [])
      .map(
        (u: any) =>
          `- ${u.firstName || ""} ${u.lastName || ""} (ID: ${u.id})\n  Email: ${u.email} | Role: ${u.role}`
      )
      .join("\n");
    return {
      content: [{ type: "text", text: formatted || "No users found." }],
    };
  }
);

safeTool(
  "create_client",
  {
    description: "Create a new CRM client/company.",
    inputSchema: {
      name: z.string().describe("Client/company name"),
      email: z.string().optional().describe("Contact email"),
      phone: z.string().optional().describe("Contact phone number"),
      company: z.string().optional().describe("Company name"),
      status: z
        .enum(["lead", "prospect", "active", "inactive"])
        .optional()
        .describe("Client status"),
      notes: z.string().optional().describe("Additional notes"),
    },
  },
  async ({ name, email, phone, company, status, notes }) => {
    const body: any = { name };
    if (email) body.email = email;
    if (phone) body.phone = phone;
    if (company) body.company = company;
    if (status) body.status = status;
    if (notes) body.notes = notes;
    const client = await apiRequest("POST", "/api/crm/clients", body);
    return {
      content: [
        {
          type: "text",
          text: `Created client "${client.name}" (ID: ${client.id})`,
        },
      ],
    };
  }
);

safeTool(
  "delete_document",
  {
    description: "Delete a document/page by ID.",
    inputSchema: {
      documentId: z.string().describe("The document UUID to delete"),
    },
  },
  async ({ documentId }) => {
    await apiRequest("DELETE", `/api/documents/${documentId}`);
    return {
      content: [
        {
          type: "text",
          text: `Deleted document ${documentId}`,
        },
      ],
    };
  }
);

safeTool(
  "get_notifications",
  {
    description: "Get your unread notifications.",
    inputSchema: {},
  },
  async () => {
    const notifications = await apiRequest("GET", "/api/notifications");
    if (!notifications || notifications.length === 0) {
      return {
        content: [{ type: "text", text: "No notifications." }],
      };
    }
    const formatted = notifications
      .map(
        (n: any) =>
          `- [${n.isRead ? "Read" : "Unread"}] ${n.title || "Notification"}\n  ${n.message || ""}\n  ${n.createdAt}`
      )
      .join("\n");
    return {
      content: [
        { type: "text", text: `Notifications:\n\n${formatted}` },
      ],
    };
  }
);


async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DocuFlow MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
