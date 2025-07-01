import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
// @ts-ignore
import { withPaymentInterceptor, decodeXPaymentResponse } from 'x402-axios';
import { privateKeyToAccount } from 'viem/accounts';
import { Hex } from 'viem';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const baseURL = process.env.RESOURCE_SERVER_URL as string || 'http://localhost:3001';
const endpointPath = process.env.ENDPOINT_PATH as string || '/gpt';

const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const USDC_ABI = [
  {
    "constant": true,
    "inputs": [ { "name": "account", "type": "address" } ],
    "name": "balanceOf",
    "outputs": [ { "name": "", "type": "uint256" } ],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [ { "name": "", "type": "uint8" } ],
    "type": "function"
  }
];

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('VS AI Minimal extension activated!');

  // Key for secret storage
  const SECRET_KEY = 'vsai-private-key';
  let currentPrivateKey: string | undefined;
  let currentAccount: any = undefined;
  let currentApi: any = undefined;

  async function updateAccountAndApi(privateKey: string) {
    // @ts-ignore
    const account = privateKeyToAccount(privateKey);
    // @ts-ignore
    const api = withPaymentInterceptor(
      axios.create({ baseURL }),
      account,
    );
    currentPrivateKey = privateKey;
    currentAccount = account;
    currentApi = api;
  }

  // On activation, load private key from secret storage
  context.secrets.get(SECRET_KEY).then(storedKey => {
    if (storedKey) {
      updateAccountAndApi(storedKey);
    } else {
      // Set default hardcoded private key if not present
      const defaultKey = '';
      context.secrets.store(SECRET_KEY, defaultKey);
      updateAccountAndApi(defaultKey);
    }
  });

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
        let lastContextType: string | undefined;
        let lastContextSelection: vscode.Selection | undefined;
        let lastUserSelection: vscode.Selection | undefined;
        let lastReplaceRange: vscode.Range | undefined;

        // --- Clean model output to remove markdown code blocks ---
        function cleanCodeBlock(output: string): string {
          // Remove triple backticks and optional language tag
          return output
            .replace(/^\s*```[a-zA-Z0-9]*\s*\n?/m, '') // opening ```lang\n
            .replace(/\n?```\s*$/m, '') // closing ```
            .trim();
        }

        webviewView.webview.onDidReceiveMessage(async (message) => {
          if (message.type === 'set-private-key') {
            const { privateKey, address } = message;
            await context.secrets.store(SECRET_KEY, privateKey);
            updateAccountAndApi(privateKey);
            vscode.window.showInformationMessage('Private key set! Address: ' + address);
            return;
          }
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
            lastUserSelection = selection;
            lastSelection = selection;
            lastEditor = editor;
            lastContextSelection = selection;
            // --- Language detection ---
            function detectLanguage(editor: vscode.TextEditor): string {
              const ext = editor.document.fileName.split('.').pop()?.toLowerCase() || '';
              if (["js","jsx","ts","tsx"].includes(ext)) return "JavaScript/TypeScript";
              if (["py"].includes(ext)) return "Python";
              if (["java"].includes(ext)) return "Java";
              if (["cpp","cc","cxx","c++","h","hpp"].includes(ext)) return "C++";
              if (["c"].includes(ext)) return "C";
              if (["go"].includes(ext)) return "Go";
              if (["rb"].includes(ext)) return "Ruby";
              if (["php"].includes(ext)) return "PHP";
              if (["rs"].includes(ext)) return "Rust";
              if (["cs"].includes(ext)) return "C#";
              return ext;
            }
            const language = detectLanguage(editor);
            // --- Extract diagnostics (errors/warnings) for the selected code ---
            let diagnosticsText = '';
            let replaceRanges: vscode.Range[] = [];
            let codeBlocks: string[] = [];
            let code = editor.document.getText(selection);
            try {
              const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
              // Only include diagnostics that overlap with the selection/context
              const relevantDiagnostics = diagnostics.filter(diag => {
                const diagStart = diag.range.start;
                const diagEnd = diag.range.end;
                const selStart = selection.start;
                const selEnd = selection.end;
                // Check for overlap
                return (
                  (diagStart.line < selEnd.line || (diagStart.line === selEnd.line && diagStart.character <= selEnd.character)) &&
                  (diagEnd.line > selStart.line || (diagEnd.line === selStart.line && diagEnd.character >= selStart.character))
                );
              });
              if (relevantDiagnostics.length > 0) {
                // Collect all full-line ranges for each diagnostic
                replaceRanges = relevantDiagnostics.map(diag => {
                  const startLine = diag.range.start.line;
                  const endLine = diag.range.end.line;
                  return new vscode.Range(
                    new vscode.Position(startLine, 0),
                    new vscode.Position(endLine, editor.document.lineAt(endLine).text.length)
                  );
                });
                // Remove duplicate/overlapping ranges
                replaceRanges = replaceRanges.filter((range, idx, arr) =>
                  arr.findIndex(r => r.start.line === range.start.line && r.end.line === range.end.line) === idx
                );
                // Sort by start line
                replaceRanges.sort((a, b) => a.start.line - b.start.line);
                codeBlocks = replaceRanges.map(range => editor.document.getText(range));
                code = codeBlocks.join('\n---BLOCK---\n');
                diagnosticsText = '\n\nKnown errors/warnings in this code:';
                for (const diag of relevantDiagnostics) {
                  diagnosticsText += `\n- [${diag.severity === 0 ? 'Error' : diag.severity === 1 ? 'Warning' : 'Info'}] ${diag.message}`;
                }
              } else {
                // Fallback: single range as before
                replaceRanges = [new vscode.Range(selection.start, selection.end)];
                codeBlocks = [code];
              }
            } catch (e) {
              // Ignore diagnostics errors
              replaceRanges = [new vscode.Range(selection.start, selection.end)];
              codeBlocks = [code];
            }
            lastReplaceRange = replaceRanges.length === 1 ? replaceRanges[0] : undefined;
            // Store all ranges for multi-block replacement
            (globalThis as any).vsai_lastReplaceRanges = replaceRanges;
            (globalThis as any).vsai_lastCodeBlocks = codeBlocks;
            if (!code.trim()) {
              webviewView.webview.postMessage({ type: 'fix-error', error: 'No code selected.' });
              return;
            }
            lastOriginal = code;
            // --- Improved function/class extraction ---
            function getFunctionOrClass(editor: vscode.TextEditor, selection: vscode.Selection): string {
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
                if (/\b(class\s+\w+)/.test(line)) { foundClass = true; classStart = i; break; }
                if (/\b(function|def|\w+\s*\()/.test(line)) { foundFunc = true; funcStart = i; break; }
              }
              // If inside a class, extract the whole class
              if (foundClass) {
                start = classStart;
                // Find class end (empty line or dedent)
                let baseIndent = doc.lineAt(start).firstNonWhitespaceCharacterIndex;
                end = start;
                for (let i = start + 1; i < totalLines; i++) {
                  const line = doc.lineAt(i).text;
                  if (!line.trim()) break;
                  if (doc.lineAt(i).firstNonWhitespaceCharacterIndex < baseIndent) break;
                  end = i;
                }
              } else if (foundFunc) {
                start = funcStart;
                let baseIndent = doc.lineAt(start).firstNonWhitespaceCharacterIndex;
                end = Math.max(end, start);
                for (let i = end + 1; i < totalLines; i++) {
                  const line = doc.lineAt(i).text;
                  if (!line.trim()) break;
                  if (doc.lineAt(i).firstNonWhitespaceCharacterIndex < baseIndent) break;
                  end = i;
                }
              }
              let lines = [];
              for (let i = start; i <= end; i++) lines.push(doc.lineAt(i).text);
              return lines.join('\n');
            }
            // --- Context selection logic based on user selection ---
            function estimateTokens(text: string): number {
              return Math.ceil(text.split(/\s+/).length * 1.3);
            }
            function getLine(editor: vscode.TextEditor, selection: vscode.Selection): string {
              return editor.document.lineAt(selection.start.line).text;
            }
            function getWholeFile(editor: vscode.TextEditor): string {
              return editor.document.getText();
            }
            // Use the contextWindow value from the webview message
            let contextCode = code;
            let contextType = 'selection';
            if (message.contextWindow === 'line') {
              contextCode = getLine(editor, selection);
              contextType = 'line';
              lastContextSelection = new vscode.Selection(selection.start.line, 0, selection.start.line, editor.document.lineAt(selection.start.line).text.length);
            } else if (message.contextWindow === 'function') {
              contextCode = getFunctionOrClass(editor, selection);
              contextType = 'function/class';
              // Find the function/class selection range
              const doc = editor.document;
              const totalLines = doc.lineCount;
              let start = selection.start.line;
              let end = selection.end.line;
              let foundClass = false;
              let foundFunc = false;
              let classStart = -1;
              let funcStart = -1;
              for (let i = start; i >= 0; i--) {
                const line = doc.lineAt(i).text;
                if (/\b(class\s+\w+)/.test(line)) { foundClass = true; classStart = i; break; }
                if (/\b(function|def|\w+\s*\()/.test(line)) { foundFunc = true; funcStart = i; break; }
              }
              if (foundClass) {
                start = classStart;
                let baseIndent = doc.lineAt(start).firstNonWhitespaceCharacterIndex;
                end = start;
                for (let i = start + 1; i < totalLines; i++) {
                  const line = doc.lineAt(i).text;
                  if (!line.trim()) break;
                  if (doc.lineAt(i).firstNonWhitespaceCharacterIndex < baseIndent) break;
                  end = i;
                }
              } else if (foundFunc) {
                start = funcStart;
                let baseIndent = doc.lineAt(start).firstNonWhitespaceCharacterIndex;
                end = Math.max(end, start);
                for (let i = end + 1; i < totalLines; i++) {
                  const line = doc.lineAt(i).text;
                  if (!line.trim()) break;
                  if (doc.lineAt(i).firstNonWhitespaceCharacterIndex < baseIndent) break;
                  end = i;
                }
              }
              lastContextSelection = new vscode.Selection(start, 0, end, doc.lineAt(end).text.length);
            } else if (message.contextWindow === 'file') {
              contextCode = getWholeFile(editor);
              contextType = 'file';
              lastContextSelection = new vscode.Selection(0, 0, editor.document.lineCount - 1, editor.document.lineAt(editor.document.lineCount - 1).text.length);
            } else {
              contextCode = code;
              contextType = 'selection';
              lastContextSelection = selection;
            }
            lastContextType = contextType;

            // --- Extra context step: summarize full file with cheap model if not 'file' context ---
            let extraContext = '';
            if (contextType !== 'file') {
              const fullFile = getWholeFile(editor);
              const cheapModel = 'gpt-3.5-turbo';
              const cheapPrompt = `Summarize the following ${language} code. Focus on key functions, classes, dependencies, and any context that would help fix a bug in a selected part. Be concise and only include what's needed.\n\nCODE:\n${fullFile}`;
              // Use a small price for the summary step
              const cheapPrice = 0.0002;
              try {
                const cheapResponse = await (async function callOpenAI(model: string, prompt: string, price: number) {
                  if (!currentApi) {
                    throw new Error('No private key set. Please set your private key in the Wallet Settings.');
                  }
                  const response = await currentApi.post(endpointPath, {
                    model,
                    prompt,
                    price
                  });
                  return response;
                })(cheapModel, cheapPrompt, cheapPrice);
                extraContext = cleanCodeBlock(cheapResponse.data.choices?.[0]?.message?.content || '');
              } catch (e) {
                // If summary fails, just skip extra context
                extraContext = '';
              }
            }
            // --- Model selection logic ---
            // Expanded model list with accuracy and cost trade-off
            const models = [
              { name: 'gpt-3.5-turbo', maxTokens: 4096, cost: 0.0005, accuracy: 1 },
              { name: 'gpt-3.5-turbo-16k', maxTokens: 16384, cost: 0.001, accuracy: 1 },
              { name: 'gpt-4', maxTokens: 8192, cost: 0.03, accuracy: 3 },
              { name: 'gpt-4-32k', maxTokens: 32768, cost: 0.06, accuracy: 3 },
              { name: 'gpt-4-turbo', maxTokens: 128000, cost: 0.01, accuracy: 2.5 },
              { name: 'gpt-4o', maxTokens: 128000, cost: 0.02, accuracy: 3.5 },
              { name: 'o4-mini-high', maxTokens: 128000, cost: 0.00193, accuracy: 2 },
            ];
            let contextTokens = estimateTokens(contextCode);
            let candidates = models.filter(m => contextTokens < m.maxTokens);
            // If no model fits, use the largest
            if (!candidates.length) {
              candidates = [models[models.length-1]];
              if (contextTokens >= candidates[0].maxTokens) {
                if (typeof contextCode === 'string') {
                  const words = contextCode.split(/\s+/);
                  contextCode = words.slice(0, Math.floor(candidates[0].maxTokens/1.3)).join(' ');
                  contextTokens = estimateTokens(contextCode);
                } else {
                  contextCode = '';
                  contextTokens = 0;
                }
              }
            }
            // Sort by cost, but if a higher-accuracy model is within 20% cost, prefer it
            candidates.sort((a, b) => a.cost - b.cost);
            let selectedModel = candidates[0];
            for (let i = candidates.length - 1; i > 0; i--) {
              const cheaper = candidates[0];
              const better = candidates[i];
              if (better.accuracy > cheaper.accuracy && (better.cost / cheaper.cost) <= 1.2) {
                selectedModel = better;
                break;
              }
            }
            // --- End model selection logic ---
            // --- Prompt construction ---
            const prompt =
              `${extraContext ? `Relevant context for the code:\n${extraContext}\n\n` : ''}` +
              `Fix and improve the following ${language} code. For each code block below, return only the fixed version of that block, in the same order, separated by a line with only '---BLOCK---'. Do not repeat the rest of the code.\n\nCODE BLOCKS (fix each, keep order, use delimiter):\n${code}${diagnosticsText}`;
            // --- End prompt construction ---
            // --- Price calculation based on context tokens ---
            // Use the per-token cost of the selected model, and assume 750 tokens per $0.001 for gpt-3.5-turbo, etc.
            // We'll use a simple proportional calculation: price = (contextTokens / model.maxTokens) * model.cost
            // Or, more accurately, price = contextTokens * (model.cost / model.maxTokens)
            let price = Number((contextTokens * (selectedModel.cost / selectedModel.maxTokens)).toFixed(6));
            if (price < 0.0001) price = 0.0001; // minimum price
            // --- Error handling and retry logic ---
            async function callOpenAI(model: string, prompt: string, price: number) {
              if (!currentApi) {
                throw new Error('No private key set. Please set your private key in the Wallet Settings.');
              }
              const response = await currentApi.post(endpointPath, {
                model,
                prompt,
                price
              });
              const paymentResponse = decodeXPaymentResponse(response.headers["x-payment-response"]);
              console.log(paymentResponse);
              return response;
            }
            let response;
            try {
              response = await callOpenAI(selectedModel.name, prompt, price);
            } catch (err: any) {
              // If context length error, try next bigger model or trim
              if (err?.response?.data?.error?.message?.includes('maximum context length')) {
                if (selectedModel.name !== models[models.length-1].name) {
                  // Try largest model
                  selectedModel = models[models.length-1];
                  response = await callOpenAI(selectedModel.name, prompt, price);
                } else {
                  // Trim context and retry
                  if (typeof contextCode === 'string') {
                    const words = contextCode.split(/\s+/);
                    contextCode = words.slice(0, Math.floor(selectedModel.maxTokens/1.3)).join(' ');
                  } else {
                    contextCode = '';
                  }
                  const newPrompt =
                    `Fix and improve the following ${language} code. Return only the fixed version of these lines, and nothing else. Do not repeat the rest of the code.\n${contextCode}${diagnosticsText}`;
                  response = await callOpenAI(selectedModel.name, newPrompt, price);
                }
              } else {
                webviewView.webview.postMessage({ type: 'fix-error', error: err.message });
                return;
              }
            }
            const fixedRaw = response.data.choices?.[0]?.message?.content || '';
            const fixed = cleanCodeBlock(fixedRaw);
            webviewView.webview.postMessage({ type: 'show-diff', original: code, fixed, filename: editor.document.fileName.split(/[\\\/]/).pop(), model: selectedModel.name, contextType, price });
          }
          if (message.type === 'apply-fix') {
            if (!lastEditor) {
              webviewView.webview.postMessage({ type: 'fix-error', error: 'No active editor to apply fix.' });
              return;
            }
            // Support multiple replace ranges
            let replaceRanges: vscode.Range[] = (globalThis as any).vsai_lastReplaceRanges || (lastReplaceRange ? [lastReplaceRange] : []);
            if (!replaceRanges.length) {
              webviewView.webview.postMessage({ type: 'fix-error', error: 'No range to apply fix.' });
              return;
            }
            if (typeof message.fixed !== 'string') {
              webviewView.webview.postMessage({ type: 'fix-error', error: 'No fixed code provided.' });
              return;
            }
            // Split fixed code by delimiter for multi-block replacement
            const fixedBlocks = message.fixed.split(/\n+---BLOCK---\n+/).map((s: string) => s.trim());
            if (fixedBlocks.length !== replaceRanges.length) {
              webviewView.webview.postMessage({ type: 'fix-error', error: `Mismatch: got ${fixedBlocks.length} blocks, expected ${replaceRanges.length}.` });
              return;
            }
            try {
              lastEditor.edit(editBuilder => {
                for (let i = 0; i < replaceRanges.length; ++i) {
                  editBuilder.replace(replaceRanges[i], fixedBlocks[i]);
                }
              }).then(success => {
                if (success) {
                  webviewView.webview.postMessage({ type: 'fix-applied' });
                } else {
                  webviewView.webview.postMessage({ type: 'fix-error', error: 'Failed to apply fix to the document.' });
                }
              });
            } catch (e: any) {
              webviewView.webview.postMessage({ type: 'fix-error', error: 'Exception during replacement: ' + (e?.message || e) });
            }
          }
          if (message.type === 'get-wallet-info') {
            let address = currentAccount?.address;
            let usdcBalance = '-';
            if (address) {
              try {
                const client = createPublicClient({ chain: baseSepolia, transport: http() });
                // Get decimals
                const decimals = BigInt(await client.readContract({
                  address: USDC_ADDRESS,
                  abi: USDC_ABI,
                  functionName: 'decimals',
                }) as bigint);
                // Get balance
                const balance = BigInt(await client.readContract({
                  address: USDC_ADDRESS,
                  abi: USDC_ABI,
                  functionName: 'balanceOf',
                  args: [address],
                }) as bigint);
                // Show full decimals
                const decimalsNum = Number(decimals);
                const balanceStr = balance.toString().padStart(decimalsNum + 1, '0');
                const intPart = balanceStr.slice(0, balanceStr.length - decimalsNum) || '0';
                const decPart = balanceStr.slice(-decimalsNum).replace(/0+$/, '') || '0';
                usdcBalance = `${intPart}.${decPart}`;
              } catch (e) {
                usdcBalance = 'Error';
              }
            }
            webviewView.webview.postMessage({ type: 'wallet-info', address, usdcBalance });
            return;
          }
        });
      }
    })
  );
}