#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.DOCUFLOW_API_URL || "http://localhost:5000";
const API_KEY = process.env.DOCUFLOW_API_KEY || "";

async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
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

type CursorPage<T> = { data?: T[] };

function formatPage<T>(
  page: CursorPage<T>,
  line: (item: T) => string,
  empty: string
): string {
  const rows = page.data ?? [];
  if (rows.length === 0) return empty;
  return rows.map(line).join("\n");
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error in ${name}: ${message}`,
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
      "List Projects in the Workspace. Returns names, statuses, and IDs.",
    inputSchema: {},
  },
  async () => {
    const page = (await apiRequest("GET", "/api/v1/projects")) as CursorPage<{
      id: string;
      name: string;
      status: string;
      clientId: string | null;
    }>;
    const formatted = formatPage(
      page,
      (p) =>
        `- ${p.name} (ID: ${p.id})\n  Status: ${p.status} | Client: ${p.clientId || "None"}`,
      "No projects found."
    );
    return { content: [{ type: "text", text: formatted }] };
  }
);

safeTool(
  "get_project",
  {
    description: "Get details of a specific Project by ID.",
    inputSchema: {
      projectId: z.string().describe("The project UUID"),
    },
  },
  async ({ projectId }) => {
    const project = (await apiRequest(
      "GET",
      `/api/v1/projects/${projectId}`
    )) as {
      name: string;
      status: string;
      clientId: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    };
    return {
      content: [
        {
          type: "text",
          text: `Project: ${project.name}\nStatus: ${project.status}\nClient ID: ${project.clientId || "None"}\nCreated: ${project.createdAt}\nUpdated: ${project.updatedAt}`,
        },
      ],
    };
  }
);

safeTool(
  "list_clients",
  {
    description: "List Clients in the Workspace.",
    inputSchema: {},
  },
  async () => {
    const page = (await apiRequest("GET", "/api/v1/clients")) as CursorPage<{
      id: string;
      name: string;
      company: string | null;
      email: string | null;
      status: string;
    }>;
    const formatted = formatPage(
      page,
      (c) =>
        `- ${c.name} (ID: ${c.id})\n  Company: ${c.company || "N/A"} | Email: ${c.email || "N/A"} | Status: ${c.status}`,
      "No clients found."
    );
    return { content: [{ type: "text", text: formatted }] };
  }
);

safeTool(
  "get_client",
  {
    description: "Get details of a specific Client.",
    inputSchema: {
      clientId: z.string().describe("The client UUID"),
    },
  },
  async ({ clientId }) => {
    const client = (await apiRequest(
      "GET",
      `/api/v1/clients/${clientId}`
    )) as {
      name: string;
      company: string | null;
      email: string | null;
      phone: string | null;
      status: string;
    };
    return {
      content: [
        {
          type: "text",
          text: `Client: ${client.name}\nCompany: ${client.company || "N/A"}\nEmail: ${client.email || "N/A"}\nPhone: ${client.phone || "N/A"}\nStatus: ${client.status}`,
        },
      ],
    };
  }
);

safeTool(
  "create_client",
  {
    description: "Create a new Client.",
    inputSchema: {
      name: z.string().describe("Client name"),
      email: z.string().optional().describe("Contact email"),
      phone: z.string().optional().describe("Contact phone number"),
      company: z.string().optional().describe("Company name"),
      status: z
        .enum(["lead", "prospect", "active", "inactive"])
        .optional()
        .describe("Client status"),
    },
  },
  async ({ name, email, phone, company, status }) => {
    const body: Record<string, unknown> = { name };
    if (email) body.email = email;
    if (phone) body.phone = phone;
    if (company) body.company = company;
    if (status) body.status = status;
    const client = (await apiRequest("POST", "/api/v1/clients", body)) as {
      id: string;
      name: string;
    };
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
  "list_time_entries",
  {
    description: "List Time Entries in the Workspace.",
    inputSchema: {},
  },
  async () => {
    const page = (await apiRequest(
      "GET",
      "/api/v1/time-entries"
    )) as CursorPage<{
      id: string;
      projectId: string;
      description: string | null;
      status: string;
      duration: number;
      startTime: string;
      endTime: string | null;
    }>;
    const formatted = formatPage(
      page,
      (e) =>
        `- ${e.description || "No description"} | ${formatDuration(e.duration || 0)} | Status: ${e.status}\n  Project: ${e.projectId} | ${e.startTime} → ${e.endTime || "ongoing"}`,
      "No time entries found."
    );
    return { content: [{ type: "text", text: `Time Entries:\n\n${formatted}` }] };
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
