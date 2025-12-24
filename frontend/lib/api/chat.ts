import type { Message } from "@/types";

export interface ChatMessage {
  projectId: string;
  message: string;
  gameType?: '2d' | '3d';
  provider?: 'claude' | 'gemini';
  multiAgent?: boolean;
}

export interface Conversation {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: any;
  fileDiffs?: any;
}

export interface ChatEventHandlers {
  onMessage?: (text: string) => void;
  onTool?: (toolCall: { name: string; input: any }) => void;
  onTurn?: (count: number) => void;
  onComplete?: (result: { result: string; usage: any }) => void;
  onError?: (error: { message?: string; subtype?: string }) => void;
  onSession?: (sessionId: string) => void;
  onStatus?: (message: string) => void;
}

/**
 * Send a chat message to the AI assistant for a project
 * Uses Server-Sent Events (SSE) for streaming responses
 */
export async function sendChatMessage(
  token: string,
  chatMessage: ChatMessage,
  handlers: ChatEventHandlers
): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📨 [CHAT API] Sending chat message');
  console.log('  URL:', `${process.env.NEXT_PUBLIC_API_URL}/api/chat`);
  console.log('  Project ID:', chatMessage.projectId);
  console.log('  Message:', chatMessage.message);
  console.log('  Game Type:', chatMessage.gameType);
  console.log('  Provider:', chatMessage.provider || 'claude');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(chatMessage),
  });

  console.log('📡 [CHAT API] Response status:', response.status, response.statusText);

  if (!response.ok) {
    console.error('❌ [CHAT API] Request failed:', response.status);
    const error = await response.json().catch(() => ({ error: 'Failed to send message' }));
    console.error('❌ [CHAT API] Error:', error);
    throw new Error(error.error || 'Failed to send message');
  }

  // Read the SSE stream
  console.log('📡 [CHAT API] Starting SSE stream...');
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    console.error('❌ [CHAT API] No response body');
    throw new Error("No response body");
  }

  let buffer = "";

  try {
    let eventCount = 0;
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log('🏁 [CHAT API] SSE stream ended');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      // Process lines in pairs (event + data)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("event: ")) {
          const eventType = line.slice(7).trim();
          const nextLine = lines[i + 1];

          if (nextLine?.startsWith("data: ")) {
            try {
              eventCount++;
              const jsonData = nextLine.slice(6);
              const data = JSON.parse(jsonData);

              console.log(`📥 [CHAT API] Event #${eventCount}: ${eventType}`, data);

              switch (eventType) {
                case "message":
                  console.log('💬 [CHAT API] Message text:', data.text?.substring(0, 100));
                  handlers.onMessage?.(data.text);
                  break;
                case "tool":
                  console.log('🔧 [CHAT API] Tool call:', data.name, 'Input:', JSON.stringify(data.input).substring(0, 100));
                  handlers.onTool?.(data);
                  break;
                case "turn":
                  console.log('🔄 [CHAT API] Turn count:', data.count);
                  handlers.onTurn?.(data.count);
                  break;
                case "complete":
                  console.log('✅ [CHAT API] Completion received');
                  handlers.onComplete?.(data);
                  break;
                case "error":
                  console.error('❌ [CHAT API] Error event:', data);
                  handlers.onError?.(data);
                  break;
                case "session":
                  console.log('🔑 [CHAT API] Session ID:', data.sessionId);
                  handlers.onSession?.(data.sessionId);
                  break;
                case "status":
                  console.log('📊 [CHAT API] Status:', data.message);
                  handlers.onStatus?.(data.message);
                  break;
                default:
                  console.warn('⚠️ [CHAT API] Unknown event type:', eventType);
              }

              // Skip the data line in the next iteration
              i++;
            } catch (parseError) {
              console.error("❌ [CHAT API] Error parsing SSE data:", parseError);
              console.error("❌ [CHAT API] Raw line:", nextLine);
            }
          }
        }
      }
    }
    console.log(`✅ [CHAT API] Processed ${eventCount} events total`);
  } finally {
    reader.releaseLock();
    console.log('🔓 [CHAT API] Reader lock released');
  }
}

/**
 * Fetch conversation history for a project
 */
export async function fetchConversations(
  token: string,
  projectId: string
): Promise<Conversation[]> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📚 [FETCH CONVERSATIONS] Fetching chat history');
  console.log('  Project ID:', projectId);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat/${projectId}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  console.log('📡 [FETCH CONVERSATIONS] Response status:', response.status);

  if (!response.ok) {
    console.error('❌ [FETCH CONVERSATIONS] Request failed:', response.status);
    throw new Error('Failed to fetch conversations');
  }

  const data = await response.json();
  console.log('✅ [FETCH CONVERSATIONS] Fetched', data.conversations.length, 'messages');

  return data.conversations;
}
