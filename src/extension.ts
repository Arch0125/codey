import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('VS AI Minimal extension activated!');

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vsai-chat-view', {
      resolveWebviewView(webviewView) {
        webviewView.webview.options = { enableScripts: true };
        const htmlPath = path.join(context.extensionPath, 'media', 'vsai-chat.html');
        console.log(htmlPath);
        webviewView.webview.html = fs.readFileSync(htmlPath, 'utf8');
        
        let lastSelection: vscode.Selection | undefined;
        let lastEditor: vscode.TextEditor | undefined;
        let lastOriginal: string | undefined;

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
            } else {
              // Expand to full lines for multi-line selection
              selection = new vscode.Selection(
                selection.start.line, 0,
                selection.end.line, editor.document.lineAt(selection.end.line).text.length
              );
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
              const response = await axios.post('https://api.openai.com/v1/chat/completions', {
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
            } catch (err: any) {
              webviewView.webview.postMessage({ type: 'fix-error', error: err.message });
            }
          }
          if (message.type === 'apply-fix') {
            if (lastEditor && lastSelection && typeof message.fixed === 'string') {
              lastEditor.edit(editBuilder => {
                editBuilder.replace(lastSelection!, message.fixed);
              });
              webviewView.webview.postMessage({ type: 'fix-applied' });
            } else {
              webviewView.webview.postMessage({ type: 'fix-error', error: 'No selection to apply fix.' });
            }
          }
        });
      }
    })
  );
}