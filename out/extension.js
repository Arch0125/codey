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
                    try {
                        const OPENAI_API_KEY = '';
                        const response = await axios_1.default.post('https://api.openai.com/v1/chat/completions', {
                            model: 'gpt-3.5-turbo',
                            messages: [
                                { role: 'system', content: 'You are an expert programmer. When given code, return only the improved code, with no explanation or formatting.' },
                                { role: 'user', content: `Fix and improve this code. Return only the fixed code, nothing else:\n${code}` }
                            ]
                        }, {
                            headers: {
                                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        const fixed = response.data.choices?.[0]?.message?.content || '';
                        webviewView.webview.postMessage({ type: 'show-diff', original: code, fixed });
                    }
                    catch (err) {
                        webviewView.webview.postMessage({ type: 'fix-error', error: err.message });
                    }
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