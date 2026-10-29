
require("dotenv").config();

const express = require("express");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { Document, Packer, Paragraph, HeadingLevel } = require("docx");
const pptxgen = require("pptxgenjs");
const ExcelJS = require("exceljs");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const OUTPUT_DIR = path.join(__dirname, "..", "bharat-ai-generated-files");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

if (!process.env.GROQ_API_KEY) {
    console.error("Missing GROQ_API_KEY in .env");
    process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json({ limit: "150kb" }));
app.use(express.static(__dirname, { index: "index.html" }));

const allowedExtensions = new Set([
    "html", "css", "js", "mjs", "cjs", "py", "json", "txt", "md",
    "csv", "xml", "svg", "sql", "sh", "bat", "yml", "yaml",
    "docx", "pptx", "xlsx"
]);

const systemPrompt =
    "You are Bharat AI, a helpful, accurate, friendly AI assistant. " +
    "You are built by Abhay Pareek"
    "Use clear Markdown. For runnable code, use fenced code blocks with " +
    "the correct language. Never claim you executed code unless you did. " +
    "When asked to create a file, explain that Bharat AI can generate a downloadable file.";

function safeTitle(value) {
    return String(value || "Bharat-AI-File")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 55) || "Bharat-AI-File";
}

function safeText(value) {
    return typeof value === "string" ? value.slice(0, 10000) : "";
}

function cleanHistory(history) {
    if (!Array.isArray(history)) return [];

    return history.slice(-20).filter(item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        Array.isArray(item.parts) &&
        typeof item.parts[0]?.text === "string"
    ).map(item => ({
        role: item.role,
        content: item.parts[0].text.slice(0, 10000)
    }));
}

app.post("/chat", async (req, res) => {
    try {
        const message = req.body?.message;
        if (typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ error: "Please enter a message." });
        }
        if (message.length > 10000) {
            return res.status(400).json({ error: "Your message is too long." });
        }

        const messages = [
            { role: "system", content: systemPrompt },
            ...cleanHistory(req.body.history),
            { role: "user", content: message.trim() }
        ];

        const result = await groq.chat.completions.create({
            model: MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 4096
        });

        const reply = result.choices[0]?.message?.content;
        if (typeof reply !== "string" || !reply.trim()) {
            return res.status(502).json({ error: "Groq returned an empty response." });
        }

        res.json({ reply });
    } catch (error) {
        console.error("Groq chat error:", error.status || "", error.message);
        res.status(500).json({
            error: "Bharat AI could not respond. Check the terminal for details."
        });
    }
});

// Generates a file's contents with Groq and packages it into the requested format.
app.post("/create-file", async (req, res) => {
    try {
        const prompt = req.body?.prompt;
        const type = String(req.body?.type || "").toLowerCase().replace(/^\./, "");
        const title = safeTitle(req.body?.title || "Bharat-AI-File");

        if (typeof prompt !== "string" || !prompt.trim()) {
            return res.status(400).json({ error: "Describe the file you want." });
        }
        if (prompt.length > 8000) {
            return res.status(400).json({ error: "The file request is too long." });
        }
        if (!allowedExtensions.has(type)) {
            return res.status(400).json({ error: "That file format is not supported." });
        }

        let instructions = "";
        if (type === "docx") {
            instructions = "Create a polished Word document. Return only the document text, no explanation. Use # for main headings and ## for subheadings. Use ordinary text and bullet lines beginning with -.";
        } else if (type === "pptx") {
            instructions = "Create a useful PowerPoint presentation. Return only slide content, no explanation. Start each slide with its title on the first line, followed by concise bullets. Separate slides with a line containing exactly ---.";
        } else if (type === "xlsx") {
            instructions = "Create Excel spreadsheet data. Return only comma-separated values (CSV), with the first row as column headings. No Markdown fences, explanations, or commas inside individual cell values. Use multiple rows of useful sample data when appropriate.";
        } else if (type === "csv") {
            instructions = "Return only valid CSV text with a header row. No Markdown fences or explanation.";
        } else if (type === "json") {
            instructions = "Return only valid JSON. No Markdown fences or explanation.";
        } else if (type === "html") {
            instructions = "Return only a complete, self-contained HTML document. No Markdown fences or explanation.";
        } else if (type === "py") {
            instructions = "Return only complete Python source code. No Markdown fences or explanation.";
        } else if (["js", "mjs", "cjs", "css", "sql", "sh", "bat", "xml", "svg", "yml", "yaml"].includes(type)) {
            instructions = `Return only complete ${type} file contents. No Markdown fences or explanation.`;
        } else {
            instructions = "Return only the requested file contents, without Markdown fences or explanations.";
        }

        const generated = await groq.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: "You generate file contents for Bharat AI. Follow the output format exactly. Do not wrap the result in Markdown code fences."
                },
                {
                    role: "user",
                    content: instructions + "\n\nUser's file request:\n" + prompt.trim()
                }
            ],
            temperature: 0.4,
            max_tokens: 7000
        });

        const content = generated.choices[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
            return res.status(502).json({ error: "Groq did not generate file contents." });
        }

        const filename = `${title}-${randomUUID()}.${type}`;
        const filePath = path.join(OUTPUT_DIR, filename);

        if (type === "docx") {
            const paragraphs = content.split(/\r?\n/).map(line => {
                const text = line.trim();
                if (text.startsWith("# ")) {
                    return new Paragraph({ text: text.slice(2), heading: HeadingLevel.HEADING_1 });
                }
                if (text.startsWith("## ")) {
                    return new Paragraph({ text: text.slice(3), heading: HeadingLevel.HEADING_2 });
                }
                if (text.startsWith("- ")) {
                    return new Paragraph({ text: text.slice(2), bullet: { level: 0 } });
                }
                return new Paragraph({ text });
            });

            const doc = new Document({
                sections: [{
                    children: [
                        new Paragraph({ text: title.replace(/_/g, " "), heading: HeadingLevel.TITLE }),
                        ...paragraphs
                    ]
                }]
            });

            fs.writeFileSync(filePath, await Packer.toBuffer(doc));
        } else if (type === "pptx") {
            const pptx = new pptxgen();
            pptx.layout = "LAYOUT_WIDE";
            pptx.author = "Bharat AI";
            pptx.subject = "AI-generated presentation";
            pptx.title = title;

            const slideTexts = content.split(/^\s*---\s*$/m).filter(s => s.trim());
            for (const slideText of slideTexts) {
                const lines = slideText.split(/\r?\n/).filter(line => line.trim());
                const heading = (lines.shift() || title).replace(/^#+\s*/, "").slice(0, 180);
                const slide = pptx.addSlide();
                slide.background = { color: "F7F8FC" };
                slide.addText(heading, {
                    x: 0.6, y: 0.4, w: 12, h: 0.8,
                    fontFace: "Aptos Display", fontSize: 28, bold: true,
                    color: "4238A5", margin: 0.08
                });

                const body = lines.map(line =>
                    line.replace(/^[-*•]\s*/, "• ")
                ).join("\n");

                slide.addText(body, {
                    x: 0.8, y: 1.5, w: 11.5, h: 5.2,
                    fontFace: "Aptos", fontSize: 19,
                    color: "25283A", valign: "top", margin: 0.12,
                    breakLine: false, paraSpaceAfterPt: 12
                });
            }

            await pptx.writeFile({ fileName: filePath });
        } else if (type === "xlsx") {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = "Bharat AI";
            const sheet = workbook.addWorksheet("Data");
            const rows = content.split(/\r?\n/).filter(Boolean);

            for (const line of rows) {
                // Simple CSV reader for AI-generated values.
                const cells = line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g) || [];
                const values = cells.map(cell =>
                    cell.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')
                );
                sheet.addRow(values);
            }

            if (sheet.rowCount > 0) {
                sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
                sheet.getRow(1).fill = {
                    type: "pattern", pattern: "solid",
                    fgColor: { argb: "FF6254E8" }
                };
                sheet.views = [{ state: "frozen", ySplit: 1 }];
                sheet.columns.forEach(column => { column.width = 22; });
                sheet.autoFilter = {
                    from: { row: 1, column: 1 },
                    to: { row: 1, column: Math.max(1, sheet.columnCount) }
                };
            }

            await workbook.xlsx.writeFile(filePath);
        } else {
            fs.writeFileSync(filePath, content, "utf8");
        }

        res.json({
            success: true,
            filename,
            downloadUrl: `/download/${encodeURIComponent(filename)}`
        });
    } catch (error) {
        console.error("File generation error:", error.status || "", error.message);
        res.status(500).json({
            error: "Could not create the file. Check the server terminal."
        });
    }
});

// Serve generated files as downloads, never as executable website content.
app.get("/download/:filename", (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) {
        return res.status(400).send("Invalid filename.");
    }

    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send("File not found. It may have been cleaned up.");
    }

    res.download(filePath, filename);
});

app.listen(PORT, () => {
    console.log(`Bharat AI is running at http://localhost:${PORT}`);
});