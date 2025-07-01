import { v4 as uuidv4 } from 'uuid';

/**
 * Ensures the memories table exists in D1
 */
export async function initializeDatabase(env: Env): Promise<void> {
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, userId TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS emails (id TEXT PRIMARY KEY, userId TEXT NOT NULL, memoryId TEXT NOT NULL, sender TEXT, recipients TEXT, subject TEXT, date TEXT, company TEXT, messageId TEXT, inReplyTo TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    );

    // migrate optional columns if upgrading from older schema
    const info = await env.DB.prepare('PRAGMA table_info(emails)').all();
    const columns = (info.results as Array<{ name: string }>).map((c) => c.name);
    if (!columns.includes('messageId')) {
      await env.DB.exec('ALTER TABLE emails ADD COLUMN messageId TEXT');
    }
    if (!columns.includes('inReplyTo')) {
      await env.DB.exec('ALTER TABLE emails ADD COLUMN inReplyTo TEXT');
    }
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS emails_userId_idx ON emails(userId)"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS emails_memory_idx ON emails(memoryId, userId)"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS emails_sender_idx ON emails(userId, sender)"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS emails_company_idx ON emails(userId, company)"
    );
    console.log("Checked/Created memories and emails tables in D1.");
  } catch (e) {
    console.error("Failed to create tables in D1:", e);
    throw e;
  }
}

/**
 * Stores a memory in D1 database
 * @param content Memory content to store
 * @param userId User ID to associate with memory
 * @param memoryId Optional ID, will generate UUID if not provided
 * @returns Memory ID
 */
export async function storeMemoryInD1(
  content: string,
  userId: string,
  env: Env,
  memoryId: string = uuidv4()
): Promise<string> {
  try {
    const stmt = env.DB.prepare(
      "INSERT INTO memories (id, userId, content) VALUES (?, ?, ?)"
    );

    await stmt.bind(memoryId, userId, content).run();
    console.log(`Memory stored in D1 with ID: ${memoryId}`);

    return memoryId;
  } catch (error) {
    console.error("Error storing memory in D1:", error);
    throw error;
  }
}

/**
 * Retrieves all memories for a user from D1
 * @param userId User ID to retrieve memories for
 * @returns Array of memory objects
 */
export async function getAllMemoriesFromD1(userId: string, env: Env): Promise<Array<{id: string, content: string}>> {
  try {
    const result = await env.DB.prepare(
      "SELECT id, content FROM memories WHERE userId = ? ORDER BY created_at DESC"
    ).bind(userId).all();

    return result.results as Array<{id: string, content: string}>;
  } catch (error) {
    console.error("Error retrieving memories from D1:", error);
    throw error;
  }
}

/**
 * Deletes a memory from D1
 * @param memoryId ID of memory to delete
 * @param userId User ID associated with memory
 */
export async function deleteMemoryFromD1(memoryId: string, userId: string, env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "DELETE FROM memories WHERE id = ? AND userId = ?"
    ).bind(memoryId, userId).run();

    console.log(`Memory ${memoryId} deleted from D1`);
  } catch (error) {
    console.error("Error deleting memory from D1:", error);
    throw error;
  }
}

/**
 * Updates the content of a memory in D1
 * @param memoryId ID of the memory to update
 * @param userId User ID associated with the memory
 * @param newContent The new content for the memory
 * @param env Environment object containing the DB binding
 */
export async function updateMemoryInD1(memoryId: string, userId: string, newContent: string, env: Env): Promise<void> {
    try {
        const stmt = env.DB.prepare(
            "UPDATE memories SET content = ? WHERE id = ? AND userId = ?"
        );
        const result = await stmt.bind(newContent, memoryId, userId).run();

        // Check the meta property for changes
        if (!result.meta || result.meta.changes === 0) {
            throw new Error(`Memory with ID ${memoryId} not found for user ${userId} or content unchanged.`);
        }

        console.log(`Memory ${memoryId} updated in D1`);
    } catch (error) {
        console.error("Error updating memory in D1:", error);
        throw error;
    }
}
