#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const API_BASE = process.env.DOCUFLOW_API_URL || "http://localhost:5000";
const API_KEY = process.env.DOCUFLOW_API_KEY || "";
async function apiRequest(method, path, body) {
    const url = `${API_BASE}${path}`;
    const headers = {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
    };
    const options = { method, headers };
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
function formatPage(page, line, empty) {
    const rows = page.data ?? [];
    if (rows.length === 0)
        return empty;
    return rows.map(line).join("\n");
}
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
}
const server = new McpServer({
    name: "docuflow",
    version: "1.0.0",
});
function safeTool(name, config, handler) {
    server.registerTool(name, config, async (args) => {
        try {
            return await handler(args);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error in ${name}: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
safeTool("list_projects", {
    description: "List Projects in the Workspace. Returns names, statuses, and IDs.",
    inputSchema: {},
}, async () => {
    const page = (await apiRequest("GET", "/api/v1/projects"));
    const formatted = formatPage(page, (p) => `- ${p.name} (ID: ${p.id})\n  Status: ${p.status} | Client: ${p.clientId || "None"}`, "No projects found.");
    return { content: [{ type: "text", text: formatted }] };
});
safeTool("get_project", {
    description: "Get details of a specific Project by ID.",
    inputSchema: {
        projectId: z.string().describe("The project UUID"),
    },
}, async ({ projectId }) => {
    const project = (await apiRequest("GET", `/api/v1/projects/${projectId}`));
    return {
        content: [
            {
                type: "text",
                text: `Project: ${project.name}\nStatus: ${project.status}\nClient ID: ${project.clientId || "None"}\nCreated: ${project.createdAt}\nUpdated: ${project.updatedAt}`,
            },
        ],
    };
});
safeTool("list_clients", {
    description: "List Clients in the Workspace.",
    inputSchema: {},
}, async () => {
    const page = (await apiRequest("GET", "/api/v1/clients"));
    const formatted = formatPage(page, (c) => `- ${c.name} (ID: ${c.id})\n  Company: ${c.company || "N/A"} | Email: ${c.email || "N/A"} | Status: ${c.status}`, "No clients found.");
    return { content: [{ type: "text", text: formatted }] };
});
safeTool("get_client", {
    description: "Get details of a specific Client.",
    inputSchema: {
        clientId: z.string().describe("The client UUID"),
    },
}, async ({ clientId }) => {
    const client = (await apiRequest("GET", `/api/v1/clients/${clientId}`));
    return {
        content: [
            {
                type: "text",
                text: `Client: ${client.name}\nCompany: ${client.company || "N/A"}\nEmail: ${client.email || "N/A"}\nPhone: ${client.phone || "N/A"}\nStatus: ${client.status}`,
            },
        ],
    };
});
safeTool("create_client", {
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
}, async ({ name, email, phone, company, status }) => {
    const body = { name };
    if (email)
        body.email = email;
    if (phone)
        body.phone = phone;
    if (company)
        body.company = company;
    if (status)
        body.status = status;
    const client = (await apiRequest("POST", "/api/v1/clients", body));
    return {
        content: [
            {
                type: "text",
                text: `Created client "${client.name}" (ID: ${client.id})`,
            },
        ],
    };
});
safeTool("list_time_entries", {
    description: "List Time Entries in the Workspace.",
    inputSchema: {},
}, async () => {
    const page = (await apiRequest("GET", "/api/v1/time-entries"));
    const formatted = formatPage(page, (e) => `- ${e.description || "No description"} | ${formatDuration(e.duration || 0)} | Status: ${e.status}\n  Project: ${e.projectId} | ${e.startTime} → ${e.endTime || "ongoing"}`, "No time entries found.");
    return { content: [{ type: "text", text: `Time Entries:\n\n${formatted}` }] };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("DocuFlow MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
