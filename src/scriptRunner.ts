import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export function activateScriptRunner(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('x-script-runner.runFile', async (uri: vscode.Uri) => {
        if (!uri) {
            uri = vscode.window.activeTextEditor?.document?.uri as vscode.Uri;
            if (!uri) {
                vscode.window.showErrorMessage('No file selected or active.');
                return;
            }
        }

        const filePath = uri.fsPath;
        const ext = path.extname(filePath).toLowerCase();
        const fileName = path.basename(filePath);

        if (!fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`File not found: ${filePath}`);
            return;
        }

        if (ext === '.exe' || ext === '.msi') {
            try {
                const child = cp.spawn(filePath, [], {
                    detached: true,
                    stdio: 'ignore',
                    windowsVerbatimArguments: true
                });
                child.unref();
                vscode.window.showInformationMessage(`Launched external binary: ${fileName}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to launch executable: ${err.message}`);
            }
            return;
        }

        let shellCommand = '';
        switch (ext) {
            case '.bat':
            case '.cmd':
                shellCommand = `cmd.exe /c "${filePath}"`;
                break;
            case '.ps1':
                shellCommand = `powershell.exe -ExecutionPolicy Bypass -File "${filePath}"`;
                break;
            case '.py':
                shellCommand = `python "${filePath}"`;
                break;
            case '.js':
                shellCommand = `node "${filePath}"`;
                break;
            case '.sh':
                shellCommand = `bash "${filePath}"`;
                break;
            default:
                shellCommand = `"${filePath}"`;
                break;
        }

        let terminal = vscode.window.activeTerminal ?? vscode.window.terminals[0];
        if (!terminal) {
            terminal = vscode.window.createTerminal();
        }

        terminal.show();
        terminal.sendText(shellCommand);
    });

    context.subscriptions.push(disposable);
}
