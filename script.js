
const STORAGE_KEY = "bharatAI_chats_v3";
const MAX_CHATS = 40;
const MAX_MESSAGES = 100;
const MAX_HISTORY = 20;

// Netlify Function endpoints
const CHAT_ENDPOINT = "/.netlify/functions/chat";
const FILE_ENDPOINT = "/.netlify/functions/create-file";

const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const historyList = document.getElementById("history-list");
const currentChatTitle = document.getElementById("current-chat-title");
const welcome = document.getElementById("welcome");
const sidebar = document.getElementById("sidebar");

let chats = loadChats();
let currentChatId = null;
let conversationHistory = [];
let isBusy = false;
let speech = null;
let typingRow = null;

function loadChats() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveChats() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(chats.slice(0, MAX_CHATS))
        );
    } catch {
        alert("Browser storage is full. Delete old chats to free space.");
    }
}

function makeId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createChat() {
    if (isBusy) return;

    currentChatId = makeId();

    chats.unshift({
        id: currentChatId,
        title: "New chat",
        messages: [],
        updatedAt: Date.now()
    });

    chats = chats.slice(0, MAX_CHATS);
    conversationHistory = [];

    saveChats();
    renderHistory();
    renderChat();
    userInput.focus();
}

function getCurrentChat() {
    return chats.find(chat => chat.id === currentChatId);
}

function renderHistory() {
    historyList.replaceChildren();

    for (const chat of chats) {
        const item = document.createElement("div");
        item.className =
            "history-item" +
            (chat.id === currentChatId ? " active" : "");

        const open = document.createElement("button");
        open.className = "history-open";
        open.textContent = chat.title || "New chat";
        open.title = chat.title || "New chat";
        open.addEventListener("click", () => openChat(chat.id));

        const del = document.createElement("button");
        del.className = "delete-chat";
        del.textContent = "×";
        del.title = "Delete chat";
        del.setAttribute("aria-label", "Delete chat");

        del.addEventListener("click", event => {
            event.stopPropagation();
            deleteChat(chat.id);
        });

        item.append(open, del);
        historyList.append(item);
    }
}

function openChat(id) {
    if (isBusy) return;

    const chat = chats.find(item => item.id === id);
    if (!chat) return;

    currentChatId = id;

    conversationHistory = chat.messages
        .filter(message =>
            message.role === "user" || message.role === "assistant"
        )
        .map(message => ({
            role: message.role,
            content: message.text
        }))
        .slice(-MAX_HISTORY);

    renderHistory();
    renderChat();
    sidebar.classList.remove("open");
}

function deleteChat(id) {
    if (isBusy) return;

    chats = chats.filter(chat => chat.id !== id);

    if (currentChatId === id) {
        currentChatId = null;
        conversationHistory = [];
    }

    saveChats();

    if (!currentChatId) {
        createChat();
    } else {
        renderHistory();
        renderChat();
    }
}

function clearCurrentChat() {
    if (isBusy) return;

    const chat = getCurrentChat();
    if (!chat) return;

    chat.messages = [];
    chat.title = "New chat";
    chat.updatedAt = Date.now();
    conversationHistory = [];

    saveChats();
    renderHistory();
    renderChat();
}

function renderChat() {
    chatBox.replaceChildren();

    const chat = getCurrentChat();
    currentChatTitle.textContent = chat?.title || "New chat";

    if (!chat || chat.messages.length === 0) {
        chatBox.append(welcome);
        welcome.classList.remove("hidden");
        return;
    }

    welcome.classList.add("hidden");

    for (const message of chat.messages) {
        addMessageToDOM(message);
    }

    chatBox.scrollTop = chatBox.scrollHeight;
}

function renderMarkdown(text) {
    const html = window.marked
        ? window.marked.parse(text, { breaks: true, gfm: true })
        : escapeHTML(text).replace(/\n/g, "<br>");

    return window.DOMPurify
        ? window.DOMPurify.sanitize(html)
        : html;
}

function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function addMessage(role, text, download = null) {
    const chat = getCurrentChat();
    if (!chat) return;

    const message = {
        role,
        text: String(text),
        download,
        id: makeId()
    };

    chat.messages.push(message);
    chat.messages = chat.messages.slice(-MAX_MESSAGES);
    chat.updatedAt = Date.now();

    if (
        role === "user" &&
        chat.messages.filter(m => m.role === "user").length === 1
    ) {
        chat.title = message.text.replace(/\s+/g, " ").slice(0, 42)
            || "New chat";
    }

    saveChats();
    renderHistory();
    currentChatTitle.textContent = chat.title;
    addMessageToDOM(message);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addMessageToDOM(message) {
    const row = document.createElement("article");
    row.className = "message-row";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = message.role === "user" ? "You" : "Bharat AI";

    const content = document.createElement("div");
    content.className =
        "message-content " +
        (message.role === "user" ? "user-message" : "ai-message");

    if (message.role === "user") {
        content.textContent = message.text;
    } else {
        content.innerHTML = renderMarkdown(message.text);
    }

    row.append(label, content);

    if (message.role === "assistant" && message.download?.url) {
        const link = document.createElement("a");
        link.className = "file-link";
        link.href = message.download.url;
        link.textContent = `⬇ Download ${message.download.filename}`;
        link.download = message.download.filename;
        row.append(link);
    }

    const actions = document.createElement("div");
    actions.className = "message-actions";

    if (message.role === "user") {
        addAction(actions, "Copy question", () => copyText(message.text));
    } else {
        addAction(actions, "Copy answer", () => copyText(message.text));
        addAction(actions, "Copy code only", () => copyOnlyCode(message.text));
        addAction(actions, "Read aloud", () => readAloud(message.text));
        addAction(actions, "Stop reading", stopReading);

        addAction(actions, "Run JavaScript", () => {
            const code = extractJavaScript(message.text);

            if (!code) {
                alert("No JavaScript code block was found.");
                return;
            }

            runJavaScript(code);
        });
    }

    row.append(actions);
    chatBox.append(row);
}

function addAction(parent, label, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-btn";
    button.textContent = label;
    button.addEventListener("click", callback);
    parent.append(button);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
    }
}

function extractCodeBlocks(answer) {
    const blocks = [];
    const pattern = /```[^\n]*\n([\s\S]*?)```/g;
    let match;

    while ((match = pattern.exec(answer)) !== null) {
        blocks.push(match[1].trim());
    }

    return blocks;
}

async function copyOnlyCode(answer) {
    const blocks = extractCodeBlocks(answer);

    if (!blocks.length) {
        alert(
            "No fenced code block found. Ask Bharat AI to put the code inside a code block."
        );
        return;
    }

    await copyText(blocks.join("\n\n"));
}

function extractJavaScript(answer) {
    const match = answer.match(
        /```(?:javascript|js)\s*\n([\s\S]*?)```/i
    );

    return match ? match[1].trim() : "";
}

function prepareSpeech(text) {
    return String(text)
        .replace(/```[\s\S]*?```/g, " Code block omitted. ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/^\s{0,3}#{1,6}\s*/gm, "")
        .replace(/^\s*>\s?/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/_(.*?)_/g, "$1")
        .replace(/~~(.*?)~~/g, "$1")
        .replace(/\|/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\s*\n+\s*/g, ". ")
        .replace(/([=*_~#`<>\\\/])+/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([,.!?;:])(?=\S)/g, "$1 ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function readAloud(text) {
    if (!("speechSynthesis" in window)) {
        alert("Read aloud is not supported by this browser.");
        return;
    }

    stopReading();

    const cleanText = prepareSpeech(text);

    if (!cleanText) {
        alert("There is no readable text in this answer.");
        return;
    }

    speech = new SpeechSynthesisUtterance(cleanText);
    speech.lang = "en-IN";
    speech.rate = 1;
    speech.pitch = 1;
    window.speechSynthesis.speak(speech);
}

function stopReading() {
    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }

    speech = null;
}

function runJavaScript(code) {
    const area = document.getElementById("run-area");
    const frame = document.getElementById("code-preview");

    area.classList.remove("hidden");

    const escaped = code.replace(/<\/script/gi, "<\\/script");

    frame.srcdoc = `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{font:14px Arial;padding:16px;color:#202123}
pre{white-space:pre-wrap;background:#f1f2f7;padding:10px;border-radius:8px}
</style></head><body>
<h3>JavaScript output</h3><pre id="output"></pre>
<script>
const out=document.getElementById("output");
const log=(...args)=>{out.textContent+=args.map(x=>{
try{return typeof x==="object"?JSON.stringify(x):String(x)}catch{return String(x)}
}).join(" ")+"\\n"};
console.log=log;
window.onerror=(msg)=>log("Error: "+msg);
try {
${escaped}
} catch(error) { log("Error: "+error.message); }
<\/script></body></html>`;

    area.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function detectFileType(prompt) {
    const text = prompt.toLowerCase();

    if (/\b(powerpoint|presentation|slides?|\.pptx)\b/.test(text)) return "pptx";
    if (/\b(excel|spreadsheet|workbook|\.xlsx)\b/.test(text)) return "xlsx";
    if (/\b(word document|word file|\.docx)\b/.test(text)) return "docx";

    const extensionMatch = text.match(
        /\.(html|css|js|mjs|cjs|py|json|txt|md|csv|xml|svg|sql|sh|bat|yml|yaml)\b/
    );

    if (extensionMatch) return extensionMatch[1];

    if (/\bpython\b/.test(text)) return "py";
    if (/\bhtml\b/.test(text)) return "html";
    if (/\bjavascript\b/.test(text)) return "js";
    if (/\bcss\b/.test(text)) return "css";
    if (/\bjson\b/.test(text)) return "json";
    if (/\bcsv\b/.test(text)) return "csv";

    return "txt";
}

function isFileRequest(prompt) {
    const text = prompt.toLowerCase();

    const asksToCreate =
        /\b(create|make|generate|build|export|download|save|produce)\b/.test(text);

    const asksForFile =
        /\b(file|document|report|spreadsheet|workbook|presentation|slides?|downloadable|\.docx|\.pptx|\.xlsx|\.html|\.css|\.js|\.py|\.json|\.txt|\.md|\.csv|\.xml|\.svg|\.sql)\b/.test(text);

    return asksToCreate && asksForFile;
}

function titleFromPrompt(prompt) {
    const match = prompt.match(
        /\b(?:called|named|title(?:d)?)\s+["']?([a-zA-Z0-9 _-]{2,50})/i
    );

    if (match) return match[1].trim();

    return prompt
        .replace(/[^\w -]/g, "")
        .split(/\s+/)
        .slice(0, 5)
        .join("-") || "Bharat-AI-File";
}

async function readResponse(response) {
    const text = await response.text();

    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(
            `Server returned an invalid response (HTTP ${response.status}). ` +
            "Check that the Netlify Function exists and inspect its logs."
        );
    }

    if (!response.ok) {
        throw new Error(
            data.error || `Request failed with HTTP ${response.status}.`
        );
    }

    return data;
}

async function createDownload(prompt) {
    const type = detectFileType(prompt);
    const title = titleFromPrompt(prompt);

    const response = await fetch(FILE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, type, title })
    });

    const data = await readResponse(response);

    if (!data.downloadUrl || !data.filename) {
        throw new Error(
            "The file-generation function did not return a download URL and filename. The Netlify file-generation function still needs to be implemented."
        );
    }

    return data;
}

function showTyping() {
    typingRow = document.createElement("article");
    typingRow.className = "message-row";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = "Bharat AI";

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = "Thinking…";

    typingRow.append(label, content);
    chatBox.append(typingRow);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function removeTyping() {
    if (typingRow) typingRow.remove();
    typingRow = null;
}

async function submitMessage(text) {
    const prompt = text.trim();

    if (!prompt || isBusy) return;

    if (!getCurrentChat()) createChat();

    isBusy = true;
    sendBtn.disabled = true;

    addMessage("user", prompt);
    userInput.value = "";
    userInput.style.height = "auto";
    showTyping();

    try {
        if (isFileRequest(prompt)) {
            const file = await createDownload(prompt);

            removeTyping();

            const extension = file.filename.split(".").pop().toUpperCase();

            addMessage(
                "assistant",
                `I've created your **${extension}** file. Use the download link below to save it.`,
                {
                    filename: file.filename,
                    url: file.downloadUrl
                }
            );
        } else {
            const history = conversationHistory.slice(-MAX_HISTORY);

            const response = await fetch(CHAT_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: prompt,
                    history
                })
            });

            const data = await readResponse(response);

            const reply = data.reply ?? data.response ?? data.answer;

            if (typeof reply !== "string" || !reply.trim()) {
                throw new Error(
                    "The chat function returned no answer. Check its response format."
                );
            }

            removeTyping();
            addMessage("assistant", reply);

            conversationHistory.push(
                { role: "user", content: prompt },
                { role: "assistant", content: reply }
            );

            conversationHistory = conversationHistory.slice(-MAX_HISTORY);
        }
    } catch (error) {
        removeTyping();

        console.error("Bharat AI request failed:", error);

        addMessage(
            "assistant",
            `Sorry, something went wrong: ${error.message}`
        );
    } finally {
        isBusy = false;
        sendBtn.disabled = false;
        userInput.focus();
    }
}

chatForm.addEventListener("submit", event => {
    event.preventDefault();
    submitMessage(userInput.value);
});

userInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chatForm.requestSubmit();
    }
});

userInput.addEventListener("input", () => {
    userInput.style.height = "auto";
    userInput.style.height =
        Math.min(userInput.scrollHeight, 180) + "px";
});

document.getElementById("new-chat-btn")
    .addEventListener("click", createChat);

document.getElementById("clear-chat-btn")
    .addEventListener("click", clearCurrentChat);

document.getElementById("mobile-history-btn")
    .addEventListener("click", () => {
        sidebar.classList.toggle("open");
    });

document.getElementById("close-run-btn")
    .addEventListener("click", () => {
        document.getElementById("run-area").classList.add("hidden");
    });

document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => {
        submitMessage(button.dataset.prompt);
    });
});

if (chats.length) {
    currentChatId = chats[0].id;

    conversationHistory = chats[0].messages
        .filter(message =>
            message.role === "user" || message.role === "assistant"
        )
        .map(message => ({
            role: message.role,
            content: message.text
        }))
        .slice(-MAX_HISTORY);

    renderHistory();
    renderChat();
} else {
    createChat();
}