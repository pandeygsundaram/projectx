# Implementation Guide

## How Claude Code Works (Reference Architecture)

This is how I (Claude Code) implement the tool-calling loop. You can use the same pattern.

---

## 1. Tool Calling Pattern

### The Loop

```javascript
async function runClaudeLoop(prompt, context) {
  const messages = [{ role: 'user', content: prompt }];
  let continueLoop = true;
  let attempts = 0;
  const MAX_ATTEMPTS = 4;

  while (continueLoop && attempts < MAX_ATTEMPTS) {
    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8000,
      messages: messages,
      tools: toolDefinitions,
      stream: true // IMPORTANT: Use streaming
    });

    let hasToolUse = false;

    for await (const event of response) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        hasToolUse = true;
        const toolName = event.content_block.name;

        // Send SSE to frontend
        sendSSE({ event: 'tool_call', data: { tool: toolName } });
      }

      if (event.type === 'content_block_delta' && event.delta.type === 'tool_use') {
        // Tool input is being streamed
        // Accumulate tool input...
      }

      if (event.type === 'message_stop') {
        // Message complete, execute tools
        const toolResults = await executeAllTools(toolCalls);

        // Check if errors exist
        const hasErrors = checkForErrors(toolResults);

        if (hasErrors) {
          attempts++;
          sendSSE({ event: 'error', data: { message: 'Fixing errors...', attempt: attempts } });

          // Add tool results to conversation
          messages.push({
            role: 'assistant',
            content: toolCalls // Claude's tool use
          });

          messages.push({
            role: 'user',
            content: toolResults.map(r => ({
              type: 'tool_result',
              tool_use_id: r.id,
              content: r.output
            }))
          });

          // Continue loop
        } else {
          // Success!
          continueLoop = false;
          sendSSE({ event: 'complete', data: { status: 'success' } });
        }
      }
    }

    if (!hasToolUse) {
      // Claude didn't use tools, just text response
      continueLoop = false;
    }
  }

  return { success: attempts < MAX_ATTEMPTS };
}
```

---

## 2. Tool Execution (No Manual Approval Needed)

**Key Insight:** Don't add approval steps. Execute tools immediately and let Claude see the results.

```javascript
async function executeAllTools(toolCalls) {
  const results = [];

  for (const toolCall of toolCalls) {
    const { id, name, input } = toolCall;

    try {
      let output;

      switch (name) {
        case 'read_file':
          output = await kubectl.exec(podName, `cat /app/${input.file_path}`);
          break;

        case 'write_file':
          await kubectl.exec(podName, `cat > /app/${input.file_path}`, input.content);
          output = 'File written successfully';
          break;

        case 'check_logs':
          output = await kubectl.logs(podName, { tail: 100 });
          break;
      }

      results.push({
        type: 'tool_result',
        tool_use_id: id,
        content: output
      });

    } catch (error) {
      results.push({
        type: 'tool_result',
        tool_use_id: id,
        content: `Error: ${error.message}`,
        is_error: true
      });
    }
  }

  return results;
}
```

**Why no approval?**
- Claude needs immediate feedback to iterate
- Approval breaks the autonomous loop
- Trust Claude's judgment (it's trained for this)

---

## 3. Server-Sent Events (SSE) Implementation

### Backend (Node.js/Express)

```javascript
app.post('/projects/create', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { prompt } = req.body;

  try {
    // Helper to send events
    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('status', { message: 'Creating project...', status: 'initializing' });

    const projectId = await createProject();
    sendEvent('status', { message: 'Starting pod...', status: 'pod_starting' });

    const podName = await startPod(projectId);
    sendEvent('status', { message: 'Calling Claude...', status: 'generating' });

    // Run Claude loop with streaming callbacks
    await runClaudeLoop(prompt, {
      onToolCall: (tool) => sendEvent('tool_call', tool),
      onError: (error) => sendEvent('error', error),
      onComplete: (result) => sendEvent('complete', result)
    });

    // Close connection
    res.write('event: stream_end\n');
    res.write('data: null\n\n');
    res.end();

  } catch (error) {
    sendEvent('error', { message: error.message });
    res.end();
  }
});
```

### Frontend (React)

```javascript
function CreateProject({ prompt }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('idle');

  const createProject = async () => {
    const eventSource = new EventSource('/projects/create', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setStatus(data.status);
      setEvents(prev => [...prev, data.message]);
    });

    eventSource.addEventListener('tool_call', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => [...prev, `Using tool: ${data.tool}`]);
    });

    eventSource.addEventListener('error', (e) => {
      const data = JSON.parse(e.data);
      setEvents(prev => [...prev, `⚠️ ${data.message}`]);
    });

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      setStatus('ready');
      // Show preview URL
      window.open(data.previewUrl, '_blank');
      eventSource.close();
    });

    eventSource.addEventListener('stream_end', () => {
      eventSource.close();
    });
  };

  return (
    <div>
      <button onClick={createProject}>Create</button>
      {events.map((msg, i) => <div key={i}>{msg}</div>)}
    </div>
  );
}
```

---

## 4. Error Detection & Auto-Fix Loop

```javascript
function checkForErrors(toolResults) {
  // Look for check_logs tool result
  const logsResult = toolResults.find(r => r.toolName === 'check_logs');

  if (!logsResult) return false;

  const logs = logsResult.content;

  // Check for common error patterns
  const errorPatterns = [
    /error/i,
    /failed/i,
    /cannot find/i,
    /typescript error/i,
    /syntax error/i
  ];

  return errorPatterns.some(pattern => pattern.test(logs));
}
```

**How the loop works:**

```
1. Claude writes code
2. Claude calls check_logs
3. Logs contain "error TS2304: Cannot find name 'useState'"
4. checkForErrors() returns true
5. Attempt counter increments
6. Tool result sent back to Claude
7. Claude sees the error in conversation
8. Claude fixes it (adds import statement)
9. Claude writes file again
10. Claude calls check_logs again
11. No errors this time
12. checkForErrors() returns false
13. Loop exits, success!
```

---

## 5. Conversation State Management

```javascript
// Store in PostgreSQL
async function saveConversationTurn(projectId, role, content, toolCalls) {
  await db.conversations.create({
    projectId,
    role, // 'user' or 'assistant'
    content: typeof content === 'string' ? content : JSON.stringify(content),
    toolCalls: toolCalls || [],
    fileDiffs: extractFileDiffs(toolCalls),
    createdAt: new Date()
  });
}

// Load context when resuming
async function loadConversationContext(projectId) {
  const history = await db.conversations.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' }
  });

  return history.map(h => ({
    role: h.role,
    content: h.content
  }));
}
```

---

## 6. Tool Definitions (What I Use)

```javascript
const tools = [
  {
    name: "read_file",
    description: "Read a file from the project. Use before editing to understand current code.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path relative to /app" }
      },
      required: ["file_path"]
    }
  },
  {
    name: "write_file",
    description: "Create or completely overwrite a file. Always provide full file content.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        content: { type: "string", description: "Complete file content" }
      },
      required: ["file_path", "content"]
    }
  },
  {
    name: "check_logs",
    description: "Check build/dev server logs for errors. ALWAYS use this after writing files.",
    input_schema: {
      type: "object",
      properties: {
        lines: { type: "number", default: 50 }
      }
    }
  },
  {
    name: "list_files",
    description: "List directory contents to understand project structure.",
    input_schema: {
      type: "object",
      properties: {
        directory: { type: "string", default: "." }
      }
    }
  },
  {
    name: "run_command",
    description: "Execute shell command (npm install, etc).",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" }
      },
      required: ["command"]
    }
  }
];
```

---

## 7. System Prompt (Critical!)

```javascript
const systemPrompt = `You are an expert React developer building a Vite + React app.

IMPORTANT RULES:
1. ALWAYS use check_logs after writing files
2. If logs show errors, fix them immediately
3. Read files before editing to understand context
4. Write complete files, not diffs
5. Keep iterating until check_logs shows no errors

Tools available: read_file, write_file, list_files, check_logs, run_command

Current project: Vite + React + TypeScript at /app
Dev server: Running on port 5173

Your goal: Make the requested changes and ensure zero errors.`;
```

---

## Key Takeaways

1. **No approval needed** - Execute tools immediately, Claude learns from results
2. **Stream everything** - Use SSE to keep frontend updated
3. **Trust the loop** - Let Claude iterate until errors are gone
4. **Save conversation** - Context is critical for resuming projects
5. **check_logs is magic** - It's how Claude knows if code works
6. **Max 3-4 retries** - Prevent infinite loops

---

## Architecture Summary

```
Frontend (SSE listener)
    ↓
Backend (SSE sender)
    ↓
Claude API (streaming)
    ↓
Tool execution (kubectl)
    ↓
Pod filesystem (/app)
    ↓
Vite dev server (logs)
    ↓
Back to Claude (tool results)
    ↓
Loop until check_logs shows no errors
    ↓
Send 'complete' event
    ↓
Frontend shows preview URL
```

That's it! Keep it simple and let Claude do the work.
