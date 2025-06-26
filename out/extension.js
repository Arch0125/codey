"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
function activate(context) {
    vscode.window.showInformationMessage('VS AI Minimal extension activated!');
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('vsai-chat-view', {
        resolveWebviewView(webviewView) {
            webviewView.webview.options = { enableScripts: true };
            const htmlPath = path.join(context.extensionPath, 'media', 'vsai-chat.html');
            console.log(htmlPath);
            webviewView.webview.html = fs.readFileSync(htmlPath, 'utf8');
            let lastSelection;
            let lastEditor;
            let lastOriginal;
            // --- Clean model output to remove markdown code blocks ---
            function cleanCodeBlock(output) {
                // Remove triple backticks and optional language tag
                return output
                    .replace(/^\s*```[a-zA-Z0-9]*\s*\n?/m, '') // opening ```lang\n
                    .replace(/\n?```\s*$/m, '') // closing ```
                    .trim();
            }
            webviewView.webview.onDidReceiveMessage(async (message) => {
                if (message.type === 'fix-request') {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        webviewView.webview.postMessage({ type: 'fix-error', error: 'No active editor.' });
                        return;
                    }
                    let selection = editor.selection;
                    if (selection.isEmpty) {
                        // Expand to the whole line if no selection
                        selection = new vscode.Selection(selection.start.line, 0, selection.start.line, editor.document.lineAt(selection.start.line).text.length);
                    }
                    else {
                        // Expand to full lines for multi-line selection
                        selection = new vscode.Selection(selection.start.line, 0, selection.end.line, editor.document.lineAt(selection.end.line).text.length);
                    }
                    const code = editor.document.getText(selection);
                    if (!code.trim()) {
                        webviewView.webview.postMessage({ type: 'fix-error', error: 'No code selected.' });
                        return;
                    }
                    lastSelection = selection;
                    lastEditor = editor;
                    lastOriginal = code;
                    // --- Language detection ---
                    function detectLanguage(editor) {
                        const ext = editor.document.fileName.split('.').pop()?.toLowerCase() || '';
                        if (["js", "jsx", "ts", "tsx"].includes(ext))
                            return "JavaScript/TypeScript";
                        if (["py"].includes(ext))
                            return "Python";
                        if (["java"].includes(ext))
                            return "Java";
                        if (["cpp", "cc", "cxx", "c++", "h", "hpp"].includes(ext))
                            return "C++";
                        if (["c"].includes(ext))
                            return "C";
                        if (["go"].includes(ext))
                            return "Go";
                        if (["rb"].includes(ext))
                            return "Ruby";
                        if (["php"].includes(ext))
                            return "PHP";
                        if (["rs"].includes(ext))
                            return "Rust";
                        if (["cs"].includes(ext))
                            return "C#";
                        return ext;
                    }
                    const language = detectLanguage(editor);
                    // --- Improved function/class extraction ---
                    function getFunctionOrClass(editor, selection) {
                        const doc = editor.document;
                        const totalLines = doc.lineCount;
                        let start = selection.start.line;
                        let end = selection.end.line;
                        // Search upwards for function or class start
                        let foundClass = false;
                        let foundFunc = false;
                        let classStart = -1;
                        let funcStart = -1;
                        for (let i = start; i >= 0; i--) {
                            const line = doc.lineAt(i).text;
                            if (/\b(class\s+\w+)/.test(line)) {
                                foundClass = true;
                                classStart = i;
                                break;
                            }
                            if (/\b(function|def|\w+\s*\()/.test(line)) {
                                foundFunc = true;
                                funcStart = i;
                                break;
                            }
                        }
                        // If inside a class, extract the whole class
                        if (foundClass) {
                            start = classStart;
                            // Find class end (empty line or dedent)
                            let baseIndent = doc.lineAt(start).firstNonWhitespaceCharacterIndex;
                            end = start;
                            for (let i = start + 1; i < totalLines; i++) {
                                const line = doc.lineAt(i).text;
                                if (!line.trim())
                                    break;
                                if (doc.lineAt(i).firstNonWhitespaceCharacterIndex < baseIndent)
                                    break;
                                end = i;
                            }
                        }
                        else if (foundFunc) {
                            start = funcStart;
                            let baseIndent = doc.lineAt(start).firstNonWhitespaceCharacterIndex;
                            end = Math.max(end, start);
                            for (let i = end + 1; i < totalLines; i++) {
                                const line = doc.lineAt(i).text;
                                if (!line.trim())
                                    break;
                                if (doc.lineAt(i).firstNonWhitespaceCharacterIndex < baseIndent)
                                    break;
                                end = i;
                            }
                        }
                        let lines = [];
                        for (let i = start; i <= end; i++)
                            lines.push(doc.lineAt(i).text);
                        return lines.join('\n');
                    }
                    // --- Context selection logic based on complexity ---
                    function estimateTokens(text) {
                        return Math.ceil(text.split(/\s+/).length * 1.3);
                    }
                    function getLine(editor, selection) {
                        return editor.document.lineAt(selection.start.line).text;
                    }
                    function getWholeFile(editor) {
                        return editor.document.getText();
                    }
                    const tokenCount = estimateTokens(code);
                    let contextCode = code;
                    let contextType = 'selection';
                    if (tokenCount <= 50) {
                        contextCode = getLine(editor, selection);
                        contextType = 'line';
                    }
                    else if (tokenCount <= 300) {
                        contextCode = getFunctionOrClass(editor, selection);
                        contextType = 'function/class';
                    }
                    else {
                        contextCode = getWholeFile(editor);
                        contextType = 'file';
                    }
                    // --- Model selection logic ---
                    const models = [
                        { name: 'gpt-3.5-turbo', maxTokens: 4096, cost: 0.0005 },
                        { name: 'gpt-3.5-turbo-16k', maxTokens: 16384, cost: 0.001 },
                        { name: 'gpt-4-turbo', maxTokens: 128000, cost: 0.01 }
                    ];
                    let contextTokens = estimateTokens(contextCode);
                    let candidates = models.filter(m => contextTokens < m.maxTokens);
                    let selectedModel = candidates.sort((a, b) => a.cost - b.cost)[0] || models[models.length - 1];
                    // --- Context window safety ---
                    // If context is too large, fallback to larger model or trim
                    if (!candidates.length) {
                        // Try largest model
                        selectedModel = models[models.length - 1];
                        if (contextTokens >= selectedModel.maxTokens) {
                            // Trim context
                            const words = contextCode.split(/\s+/);
                            contextCode = words.slice(0, Math.floor(selectedModel.maxTokens / 1.3)).join(' ');
                            contextTokens = estimateTokens(contextCode);
                        }
                    }
                    // --- End model selection logic ---
                    // --- Prompt construction ---
                    const prompt = contextType === 'line' ?
                        `Fix and improve this line of ${language} code. Return only the fixed line, nothing else:\n${contextCode}` :
                        contextType === 'function/class' ?
                            `Fix and improve this ${language} function or class. Return only the fixed code, nothing else:\n${contextCode}` :
                            `Fix and improve this ${language} file. Return only the fixed file, nothing else:\n${contextCode}`;
                    // --- End prompt construction ---
                    // --- Error handling and retry logic ---
                    async function callOpenAI(model, prompt) {
                        const OPENAI_API_KEY = '';
                        return axios_1.default.post('https://api.openai.com/v1/chat/completions', {
                            model,
                            messages: [
                                { role: 'system', content: 'You are an expert programmer.' },
                                { role: 'user', content: prompt }
                            ]
                        }, {
                            headers: {
                                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                                'Content-Type': 'application/json'
                            }
                        });
                    }
                    let response;
                    try {
                        response = await callOpenAI(selectedModel.name, prompt);
                    }
                    catch (err) {
                        // If context length error, try next bigger model or trim
                        if (err?.response?.data?.error?.message?.includes('maximum context length')) {
                            if (selectedModel.name !== models[models.length - 1].name) {
                                // Try largest model
                                selectedModel = models[models.length - 1];
                                response = await callOpenAI(selectedModel.name, prompt);
                            }
                            else {
                                // Trim context and retry
                                const words = contextCode.split(/\s+/);
                                contextCode = words.slice(0, Math.floor(selectedModel.maxTokens / 1.3)).join(' ');
                                const newPrompt = contextType === 'line' ?
                                    `Fix and improve this line of ${language} code. Return only the fixed line, nothing else:\n${contextCode}` :
                                    contextType === 'function/class' ?
                                        `Fix and improve this ${language} function or class. Return only the fixed code, nothing else:\n${contextCode}` :
                                        `Fix and improve this ${language} file. Return only the fixed file, nothing else:\n${contextCode}`;
                                response = await callOpenAI(selectedModel.name, newPrompt);
                            }
                        }
                        else {
                            webviewView.webview.postMessage({ type: 'fix-error', error: err.message });
                            return;
                        }
                    }
                    const fixedRaw = response.data.choices?.[0]?.message?.content || '';
                    const fixed = cleanCodeBlock(fixedRaw);
                    webviewView.webview.postMessage({ type: 'show-diff', original: code, fixed, filename: editor.document.fileName.split(/[\\\/]/).pop(), model: selectedModel.name, contextType });
                }
                if (message.type === 'apply-fix') {
                    if (lastEditor && lastSelection && typeof message.fixed === 'string') {
                        lastEditor.edit(editBuilder => {
                            editBuilder.replace(lastSelection, message.fixed);
                        });
                        webviewView.webview.postMessage({ type: 'fix-applied' });
                    }
                    else {
                        webviewView.webview.postMessage({ type: 'fix-error', error: 'No selection to apply fix.' });
                    }
                }
            });
        }
    }));
}
//# sourceMappingURL=extension.js.map