import { Hono } from "hono";
import { MyMCP } from "./mcp";
import { getAllMemoriesFromD1, initializeDatabase, deleteMemoryFromD1, updateMemoryInD1 } from "./utils/db";
import { deleteVectorById, updateMemoryVector } from "./utils/vectorize";
import {
  storeEmailMemory,
  listEmails,
  deleteEmail,
  searchEmailMemories,
  getEmailWithContent,
  EmailData,
} from "./utils/email";

const app = new Hono<{
  Bindings: Env;
}>();

// Initialize database once
let dbInitialized = false;

// Middleware for one-time database initialization
app.use("*", async (c, next) => {
  if (!dbInitialized) {
    try {
      console.log("Attempting database initialization...");
      await initializeDatabase(c.env);
      dbInitialized = true;
      console.log("Database initialized successfully.");
    } catch (e) {
      console.error("Failed to initialize D1 database:", e);
    }
  }
  await next();
});

// index.html
app.get("/", async (c) => await c.env.ASSETS.fetch(c.req.raw));

// Get all memories for a user
app.get("/:userId/memories", async (c) => {
  const userId = c.req.param("userId");

  try {
    const memories = await getAllMemoriesFromD1(userId, c.env);
    return c.json({ success: true, memories });
  } catch (error) {
    console.error("Error retrieving memories:", error);
    return c.json({ success: false, error: "Failed to retrieve memories" }, 500);
  }
});

// Delete a memory for a user
app.delete("/:userId/memories/:memoryId", async (c) => {
  const userId = c.req.param("userId");
  const memoryId = c.req.param("memoryId");

  try {
    // 1. Delete from D1
    await deleteMemoryFromD1(memoryId, userId, c.env);
    console.log(`Deleted memory ${memoryId} for user ${userId} from D1.`);

    // 2. Delete from Vectorize index
    try {
      await deleteVectorById(memoryId, userId, c.env);
      console.log(`Attempted to delete vector ${memoryId} for user ${userId} from Vectorize.`);
    } catch (vectorError) {
      console.error(`Failed to delete vector ${memoryId} for user ${userId} from Vectorize:`, vectorError);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error(`Error deleting memory ${memoryId} (D1 primary) for user ${userId}:`, error);
    return c.json({ success: false, error: "Failed to delete memory" }, 500);
  }
});

// Update a specific memory for a user
app.put("/:userId/memories/:memoryId", async (c) => {
  const userId = c.req.param("userId");
  const memoryId = c.req.param("memoryId");
  let updatedContent: string;

  try {
    // Get updated content from request body
    const body = await c.req.json();
    if (!body || typeof body.content !== "string" || body.content.trim() === "") {
      return c.json({ success: false, error: "Invalid or missing content in request body" }, 400);
    }
    updatedContent = body.content.trim();
  } catch (e) {
    console.error("Failed to parse request body:", e);
    return c.json({ success: false, error: "Failed to parse request body" }, 400);
  }

  try {
    // 1. Update in D1
    await updateMemoryInD1(memoryId, userId, updatedContent, c.env);
    console.log(`Updated memory ${memoryId} for user ${userId} in D1.`);

    // 2. Update vector in Vectorize
    try {
      await updateMemoryVector(memoryId, updatedContent, userId, c.env);
      console.log(`Updated vector ${memoryId} for user ${userId} in Vectorize.`);
    } catch (vectorError) {
      console.error(`Failed to update vector ${memoryId} for user ${userId} in Vectorize:`, vectorError);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error(`Error updating memory ${memoryId} for user ${userId}:`, error);
    const errorMessage = error.message || "Failed to update memory";
    if (errorMessage.includes("not found")) {
      return c.json({ success: false, error: errorMessage }, 404);
    }
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// Store an email for a user
app.post("/:userId/emails", async (c) => {
  const userId = c.req.param("userId");
  let email: EmailData;

  try {
    email = await c.req.json<EmailData>();
    if (!email.subject || !email.body || !email.sender) {
      return c.json({ success: false, error: "Missing required email fields" }, 400);
    }
  } catch (e) {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const id = await storeEmailMemory(email, userId, c.env);
    return c.json({ success: true, id });
  } catch (err) {
    console.error("Error storing email", err);
    return c.json({ success: false, error: "Failed to store email" }, 500);
  }
});

// List emails for a user
app.get("/:userId/emails", async (c) => {
  const userId = c.req.param("userId");
  try {
    const emails = await listEmails(userId, c.env);
    return c.json({ success: true, emails });
  } catch (e) {
    console.error("Error retrieving emails", e);
    return c.json({ success: false, error: "Failed to retrieve emails" }, 500);
  }
});

// Get a single email with content
app.get("/:userId/emails/:memoryId", async (c) => {
  const userId = c.req.param("userId");
  const memoryId = c.req.param("memoryId");
  try {
    const email = await getEmailWithContent(memoryId, userId, c.env);
    if (!email) return c.json({ success: false, error: "Not Found" }, 404);
    return c.json({ success: true, email });
  } catch (e) {
    console.error("Error retrieving email", e);
    return c.json({ success: false, error: "Failed to retrieve email" }, 500);
  }
});

// Delete email
app.delete("/:userId/emails/:memoryId", async (c) => {
  const userId = c.req.param("userId");
  const memoryId = c.req.param("memoryId");
  try {
    await deleteEmail(memoryId, userId, c.env);
    await deleteMemoryFromD1(memoryId, userId, c.env);
    await deleteVectorById(memoryId, userId, c.env);
    return c.json({ success: true });
  } catch (e) {
    console.error("Error deleting email", e);
    return c.json({ success: false, error: "Failed to delete email" }, 500);
  }
});

// Search email memories
app.get("/:userId/emails/search", async (c) => {
  const userId = c.req.param("userId");
  const query = c.req.query("q");
  const company = c.req.query("company");
  if (!query) {
    return c.json({ success: false, error: "Missing query" }, 400);
  }
  try {
    const results = await searchEmailMemories(query, userId, c.env, company);
    return c.json({ success: true, results });
  } catch (err) {
    console.error("Error searching emails", err);
    return c.json({ success: false, error: "Failed to search emails" }, 500);
  }
});

app.mount("/", async (req, env, ctx) => {
  // Hono's app.mount handler receives the raw Request, not the Hono Context.
  const url = new URL(req.url);
  // Example path: /someUserId/sse
  const pathSegments = url.pathname.split("/");
  // pathSegments will be ["", "someUserId", "sse"]
  const userId = pathSegments[1];

  if (!userId) {
    // Should not happen with Hono routing matching /:userId/, but good practice
    return new Response("Bad Request: Could not extract userId from URL path", { status: 400 });
  }

  // Pass the dynamic userId to the MCP agent's props
  ctx.props = {
    userId: userId,
  };

  // So the full path handled by MCPMemory will be /:userId/sse
  const response = await MyMCP.mount(`/${userId}/sse`).fetch(req, env, ctx);

  if (response) {
    return response;
  }

  // Fallback if MCPMemory doesn't handle the specific request under its mount point
  return new Response("Not Found within MCP mount", { status: 404 });
});

export default app;

export { MyMCP };
