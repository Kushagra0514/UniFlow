import * as webllm from "@mlc-ai/web-llm";

let engine;
let auditData = null;
const modelId = "Qwen3-1.7B-q4f16_1-MLC"; 
let chatHistory = [];
let currentSessionId = null;

const STORAGE_KEY = "uniflow_sessions";

// ─── Session Persistence ───────────────────────────────────────────────────

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadAllSessions() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch { return []; }
}

function saveAllSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

/**
 * Save the current chatHistory as a session.
 * Creates a new session or updates an existing one.
 */
function saveCurrentSession() {
    if (chatHistory.length <= 2) return; // Only context + ack, nothing real yet

    const sessions = loadAllSessions();

    // Extract preview from first real user message (index 2)
    const firstUserMsg = chatHistory.find((m, i) => i >= 2 && m.role === "user");
    const preview = firstUserMsg ? firstUserMsg.content.substring(0, 80) : "Chat session";

    const existingIdx = sessions.findIndex(s => s.id === currentSessionId);
    const sessionData = {
        id: currentSessionId || generateId(),
        timestamp: Date.now(),
        preview,
        messages: chatHistory
    };

    if (existingIdx >= 0) {
        sessions[existingIdx] = sessionData;
    } else {
        currentSessionId = sessionData.id;
        sessions.unshift(sessionData); // Newest first
    }

    // Keep max 20 sessions to avoid filling up localStorage
    if (sessions.length > 20) sessions.length = 20;

    saveAllSessions(sessions);
    renderSessionList();
}

function deleteSession(id) {
    let sessions = loadAllSessions();
    sessions = sessions.filter(s => s.id !== id);
    saveAllSessions(sessions);

    // If we just deleted the active session, reset to new chat
    if (id === currentSessionId) {
        startNewChat();
    }
    renderSessionList();
}

function formatTimeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
}

function renderSessionList() {
    const list = document.getElementById("sessions-list");
    const countBadge = document.getElementById("history-count");
    if (!list) return;

    const sessions = loadAllSessions();
    countBadge.textContent = sessions.length > 0 ? `(${sessions.length})` : "";

    if (sessions.length === 0) {
        list.innerHTML = '<div class="sessions-empty">No saved chats yet</div>';
        return;
    }

    list.innerHTML = "";
    sessions.forEach(session => {
        const card = document.createElement("div");
        card.className = "session-card";
        if (session.id === currentSessionId) {
            card.style.borderLeft = "2px solid var(--color-silver)";
        }

        const info = document.createElement("div");
        info.className = "session-info";

        const preview = document.createElement("div");
        preview.className = "session-preview";
        preview.textContent = session.preview;

        const time = document.createElement("div");
        time.className = "session-time";
        time.textContent = formatTimeAgo(session.timestamp);

        info.appendChild(preview);
        info.appendChild(time);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "session-delete";
        deleteBtn.innerHTML = "✕";
        deleteBtn.title = "Delete this chat";
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteSession(session.id);
        });

        card.appendChild(info);
        card.appendChild(deleteBtn);

        card.addEventListener("click", () => {
            loadSession(session.id);
        });

        list.appendChild(card);
    });
}

function loadSession(id) {
    const sessions = loadAllSessions();
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    currentSessionId = session.id;
    chatHistory = session.messages;

    const output = document.getElementById("ai-output");
    output.innerHTML = "";

    // Render all visible messages (skip hidden context at indices 0, 1)
    for (let i = 2; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        if (msg.role === "user") {
            output.appendChild(createBubble("user", msg.content));
        } else if (msg.role === "assistant") {
            output.appendChild(createBubble("ai", msg.content));
        }
    }
    output.scrollTop = output.scrollHeight;

    // Close history drawer
    const drawer = document.getElementById("saved-sessions");
    if (drawer) drawer.classList.add("hidden");

    renderSessionList();
}

function startNewChat() {
    chatHistory = [];
    currentSessionId = null;

    const output = document.getElementById("ai-output");
    output.innerHTML = '<div class="chat-welcome">Welcome to UniFlow. Load your degree data to enable AI scheduling advice.</div>';

    renderSessionList();
}

// ─── Engine Init ───────────────────────────────────────────────────────────

async function initEngine() {
    const statusLabel = document.getElementById("ai-status");
    const btn = document.getElementById("ai-btn");
    try {
        if (!navigator.gpu) {
            statusLabel.innerText = "Status: WebGPU not supported.";
            return;
        }
        
        statusLabel.innerText = "Status: Initializing Qwen 3 1.7B...";
        engine = await webllm.CreateMLCEngine(modelId, {
            initProgressCallback: (report) => {
                statusLabel.innerText = `Status: ${report.text}`;
            }
        });
        
        btn.disabled = false;
        statusLabel.innerText = "Status: AI Ready (Turbo Mode).";
    } catch (err) {
        statusLabel.innerText = "Status: AI initialization failed.";
        console.error("WebLLM Init Error:", err);
    }
}

// ─── Input Sanitization ────────────────────────────────────────────────────

/**
 * Sanitize user input to neutralize XSS, strip hidden control characters,
 * block prompt injection techniques, and restrict long strings to prevent WebGPU OOM.
 */
function sanitizeInput(text) {
    if (!text) return "";
    
    // 1. Strip non-printable control characters
    let sanitized = text.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, "");
    
    // 2. Escape HTML entities to prevent XSS in rendering
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        "/": '&#x2F;'
    };
    sanitized = sanitized.replace(/[&<>"'/]/g, m => map[m]);
    
    // 3. Prompt Injection detection & mitigation
    const injectionPatterns = [
        /ignore\s+(all\s+)?previous\s+instructions/gi,
        /system\s+override/gi,
        /you\s+must\s+now\s+act\s+as/gi,
        /forget\s+(your\s+)?instructions/gi,
        /new\s+role/gi,
        /developer\s+mode/gi,
        /bypass\s+restrictions/gi,
        /dan\s+mode/gi,
        /jailbreak/gi,
        /system\s+prompt/gi
    ];
    
    for (const pattern of injectionPatterns) {
        if (pattern.test(sanitized)) {
            sanitized = sanitized.replace(pattern, "[ATTEMPTED INJECTION NEUTRALIZED]");
        }
    }
    
    // 4. Bounded length (max 800 characters) to prevent memory hogging/exhaustion
    if (sanitized.length > 800) {
        sanitized = sanitized.substring(0, 800) + "... [truncated for safety]";
    }
    
    return sanitized;
}

// ─── Chat Bubbles ──────────────────────────────────────────────────────────

/**
 * Create a chat bubble DOM element.
 * @param {"user"|"ai"} role 
 * @param {string} text 
 * @returns {HTMLDivElement}
 */
function createBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;

    const label = document.createElement("div");
    label.className = "bubble-label";
    label.textContent = role === "user" ? "You" : "UniFlow AI";

    const body = document.createElement("div");
    body.className = "bubble-body";

    if (role === "ai" && !text) {
        // Typing indicator / thinking skeleton
        const indicator = document.createElement("div");
        indicator.className = "typing-indicator";
        indicator.innerHTML = "<span></span><span></span><span></span>";
        body.appendChild(indicator);
    } else {
        body.textContent = text;
    }

    bubble.appendChild(label);
    bubble.appendChild(body);
    return bubble;
}

// ─── Chat Handler ──────────────────────────────────────────────────────────

window.runChat = async () => {
    if (!auditData || !engine) return;
    
    const inputField = document.getElementById("ai-input");
    const btn = document.getElementById("ai-btn");
    const output = document.getElementById("ai-output");
    
    const rawQuery = inputField.value.trim();
    if (!rawQuery) return;
    
    const userQuery = sanitizeInput(rawQuery);

    inputField.value = "";
    btn.disabled = true;

    // Clear the welcome message on first real interaction
    const welcome = output.querySelector(".chat-welcome");
    if (welcome) welcome.remove();
    
    if (chatHistory.length === 0) {
        const summary = window.transformForAI(auditData);
        chatHistory.push({ 
            role: "user", 
            content: `You are the UGA Senior AI Advisor. You have direct access to this student's degree audit data.

HERE IS THE STUDENT'S CLEANED DEGREE AUDIT:
${summary}

RULES:
- Answer questions using the specific courses and requirements listed above.
- Each requirement shows its status: COMPLETED, IN_PROGRESS, or NEEDED.
- "courses" shows what the student already took. "options" shows what they can take.
- If asked about overlap, find course codes that appear in multiple sections.
- Be concise, direct, and helpful. Do NOT use markdown formatting, asterisks, or bold text. Use plain text only.

Do you understand your instructions?` 
        });
        chatHistory.push({
            role: "assistant",
            content: "I understand my instructions and have reviewed the student's degree audit. I am ready to answer their questions."
        });

        // Assign a new session ID for this conversation
        currentSessionId = generateId();
    }

    chatHistory.push({ role: "user", content: userQuery });
    saveCurrentSession();

    // Render user bubble
    output.appendChild(createBubble("user", userQuery));
    output.scrollTop = output.scrollHeight;

    // Create AI bubble with typing skeleton
    const aiBubble = createBubble("ai", "");
    aiBubble.classList.add("thinking-skeleton");
    const aiBody = aiBubble.querySelector(".bubble-body");
    output.appendChild(aiBubble);
    output.scrollTop = output.scrollHeight;

    try {
        const chunks = await engine.chat.completions.create({
            messages: chatHistory,
            stream: true,
            max_tokens: 512,
            temperature: 0.6,
            // Disable Qwen3's reasoning/thinking mode so we get direct answers
            extra_body: { enable_thinking: false }
        });

        let rawFull = "";
        let skeletonCleared = false;

        for await (const chunk of chunks) {
            const token = chunk.choices[0]?.delta?.content || "";
            rawFull += token;

            // Live-clean: strip think tags and markdown artifacts from accumulated text
            let display = rawFull
                .replace(/<think>[\s\S]*?<\/think>/gi, "")
                .replace(/<think>[\s\S]*/gi, "")   // unclosed <think> block still streaming
                .replace(/<\/think>/gi, "")
                .replace(/[*#`]/g, "")
                .trim();

            // Skip rendering while we're still inside a <think> block
            if (!display) continue;

            // First real visible token — swap skeleton for text
            if (!skeletonCleared) {
                aiBody.innerHTML = "";
                aiBubble.classList.remove("thinking-skeleton");
                skeletonCleared = true;
            }

            aiBody.textContent = display;
            output.scrollTop = output.scrollHeight;
        }

        // Final cleanup pass
        let fullResponse = rawFull
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/<think>/gi, "")
            .replace(/<\/think>/gi, "")
            .replace(/[*#`]/g, "")
            .trim();

        if (!skeletonCleared) {
            aiBody.innerHTML = "";
            aiBubble.classList.remove("thinking-skeleton");
        }
        aiBody.textContent = fullResponse;

        chatHistory.push({ role: "assistant", content: fullResponse });
        saveCurrentSession();
    } catch (err) {
        aiBody.innerHTML = "";
        aiBody.textContent = "Error: " + err.message;
        aiBubble.classList.remove("thinking-skeleton");
    }
    btn.disabled = false;
    output.scrollTop = output.scrollHeight;
};

// ─── Bootstrap ─────────────────────────────────────────────────────────────

window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "AUDIT_DATA_READY") {
        auditData = event.data.payload;
        initEngine();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    // Render saved sessions list (but do NOT auto-load any)
    renderSessionList();

    // Wire up buttons
    const btn = document.getElementById("ai-btn");
    const input = document.getElementById("ai-input");
    const newChatBtn = document.getElementById("new-chat-btn");
    const historyBtn = document.getElementById("history-toggle-btn");
    const drawer = document.getElementById("saved-sessions");

    if (btn) btn.onclick = window.runChat;
    if (input) {
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") window.runChat();
        });
    }

    if (newChatBtn) {
        newChatBtn.addEventListener("click", () => {
            startNewChat();
        });
    }

    if (historyBtn && drawer) {
        historyBtn.addEventListener("click", () => {
            drawer.classList.toggle("hidden");
        });
    }
});
