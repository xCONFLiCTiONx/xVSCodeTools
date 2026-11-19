const vscode = require('vscode');

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('reloadWindowButton.reload', () =>
            vscode.commands.executeCommand('workbench.action.reloadWindow'))
    );

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    item.command = 'reloadWindowButton.reload';
    item.text = '$(refresh) Reload';
    item.tooltip = 'Reload VS Code Window';
    item.show();
    context.subscriptions.push(item);
}

function deactivate() {}

module.exports = { activate, deactivate };

