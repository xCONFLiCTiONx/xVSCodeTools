import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import * as cp from 'child_process';

export class LiveServer {
    private server: http.Server | null = null;
    private clients: Set<http.ServerResponse> = new Set();
    private port = 0;
    private root = '';

    public async start(root: string, preferredPort = 8080): Promise<number> {
        this.root = root;
        if (this.server && this.server.listening) return this.port;

        let p = preferredPort;
        for (let i = 0; i < 20; i++) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const s = http.createServer((req, res) => this.handle(req, res));
                    s.once('error', reject);
                    s.listen(p, '127.0.0.1', () => {
                        this.server = s;
                        resolve();
                    });
                });
                this.port = p;
                return p;
            } catch {
                p++;
            }
        }
        throw new Error('Could not bind HTTP server port.');
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse) {
        const parsed = url.parse(req.url || '/', true);
        if (parsed.pathname === '/__live_reload_sse__') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
            this.clients.add(res);
            req.on('close', () => this.clients.delete(res));
            return;
        }

        let filePath = path.join(this.root, path.normalize(parsed.pathname || '/').replace(/^(\.\.[\/\\])+/, ''));
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes: Record<string, string> = {
                '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
                '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
                '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
                '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
                '.csv': 'text/csv; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8',
                '.svg': 'image/svg+xml; charset=utf-8', '.yml': 'text/plain; charset=utf-8',
                '.yaml': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8',
                '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8',
                '.jsx': 'text/plain; charset=utf-8', '.c': 'text/plain; charset=utf-8',
                '.h': 'text/plain; charset=utf-8', '.cpp': 'text/plain; charset=utf-8',
                '.java': 'text/plain; charset=utf-8', '.sh': 'text/plain; charset=utf-8',
                '.ps1': 'text/plain; charset=utf-8'
            };
            const mime = mimeTypes[ext] || 'application/octet-stream';
            let content = fs.readFileSync(filePath);
            if (ext === '.html') {
                content = Buffer.concat([content, Buffer.from('<script>(new EventSource("/__live_reload_sse__")).onmessage=e=>{if(e.data==="reload")window.location.reload();};</script>')]);
            }
            res.writeHead(200, { 'Content-Type': mime });
            res.end(content);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    }

    public notifyReload() {
        for (const c of this.clients) c.write('data: reload\n\n');
    }

    public stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}

export function activateHtmlDebugger(context: vscode.ExtensionContext) {
    const server = new LiveServer();
    let watcher: vscode.FileSystemWatcher | null = null;
    let statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'htmlChromeDebugger.stopServer';
    context.subscriptions.push(statusBar);

    context.subscriptions.push(
        vscode.commands.registerCommand('htmlChromeDebugger.debugFile', async (uri?: vscode.Uri) => {
            const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!fileUri || fileUri.scheme !== 'file') {
                vscode.window.showErrorMessage('Please select a valid local file.');
                return;
            }
            const filePath = fileUri.fsPath;
            const rootDir = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath || path.dirname(filePath);
            const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');

            const port = await server.start(rootDir, 8080);
            if (watcher) watcher.dispose();
            watcher = vscode.workspace.createFileSystemWatcher('**/*');
            watcher.onDidChange(() => server.notifyReload());

            const targetUrl = `http://localhost:${port}/${rel}`;
            statusBar.text = `$(browser) Live Server: ${port}`;
            statusBar.show();

            const chromePath = process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome';
            try {
                cp.spawn(chromePath, [`--remote-debugging-port=9222`, targetUrl], { detached: true, stdio: 'ignore' }).unref();
            } catch {
                vscode.env.openExternal(vscode.Uri.parse(targetUrl));
            }
        }),
        vscode.commands.registerCommand('htmlChromeDebugger.stopServer', () => {
            server.stop();
            if (watcher) watcher.dispose();
            statusBar.hide();
            vscode.window.showInformationMessage('HTML Live Server stopped.');
        }),
        vscode.commands.registerCommand('htmlChromeDebugger.openInChrome', () => {
            vscode.commands.executeCommand('htmlChromeDebugger.debugFile');
        })
    );
}
