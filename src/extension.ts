import { commands, ExtensionContext, FileType, OutputChannel, TextDocument, Uri, window, workspace, WorkspaceFolder } from 'vscode';
import { CloseAction, ErrorAction, ExecuteCommandRequest, LanguageClient, LanguageClientOptions, RevealOutputChannelOn, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { setDiagnosticsBegin, setDiagnosticsEnd, setCleanBegin, setCleanEnd, diagnosticsBegin, diagnosticsEnd, cleanBegin, cleanEnd } from './notifications';
import { registerMiddleware, unregisterMiddleware, middleware } from './middleware';
import * as path from 'path';
type ExtensionCommands = { [cmd: string]: (args: any[]) => void };

const clients: Map<string, LanguageClient> = new Map();
const commandCode: Map<string, ExtensionCommands> = new Map();

export function activate(context: ExtensionContext) {
    const activatePS = require('../../output/Main').main;

    // const module = require.resolve('purescript-language-server');

    const module = path.join(context.extensionPath, 'dist', 'server.js');

    const opts = { module, transport: TransportKind.ipc };
    const serverOptions: ServerOptions =
    {
        run: opts,
        debug: {
            ...opts, options: {
                execArgv: [
                    "--nolazy",
                    "--inspect=6009"
                ]
            }
        },

    }
    const output = window.createOutputChannel("IDE PureScript");
    // Options to control the language client
    const clientOptions = (folder: Uri): LanguageClientOptions => ({

        // Register for PureScript and JavaScript documents in the given root folder
        documentSelector: [
            { scheme: 'file', language: 'purescript', pattern: `${folder.fsPath}/**/*` },
            { scheme: 'file', language: 'javascript', pattern: `${folder.fsPath}/**/*` },
            // ...folder.index === 0 ? [{ scheme: 'untitled', language: 'purescript' }] : []
        ],
        workspaceFolder: {
            uri: folder,
            name: "",
            index: 0
        },
        synchronize: {
            configurationSection: 'purescript',
            fileEvents:
                [workspace.createFileSystemWatcher('**/*.purs')
                    , workspace.createFileSystemWatcher('**/*.js')
                ]
        },
        outputChannel: output,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        errorHandler: {
            error: (e, m, c) => { console.error(e, m, c); return { action: ErrorAction.Continue } },
            closed: () => ({ action: CloseAction.DoNotRestart })
        },
        initializationOptions: {
            executeCommandProvider: false
        },
        middleware
    });

    let commandNames: string[] = [
        "caseSplit-explicit",
        "addClause-explicit",
        "addCompletionImport",
        "addModuleImport",
        "replaceSuggestion",
        "replaceAllSuggestions",
        "build",
        "clean",
        "typedHole-explicit",
        "startPscIde",
        "stopPscIde",
        "restartPscIde",
        "getAvailableModules",
        "search",
        "fixTypo",
        "sortImports"
    ].map(x => `purescript.${x}`);

    const getSpagoRoot = (doc: TextDocument) => {
        if (doc.uri.scheme === 'file') {
            return findSpagoRoot(output, doc.uri)
        }
        return null;
    }

    commandNames.forEach(command => {
        commands.registerTextEditorCommand(command, async (ed, edit, ...args) => {
            const wf = await getSpagoRoot(ed.document);
            if (!wf) { return; }
            const lc = clients.get(wf.fsPath);
            if (!lc) {
                output.appendLine("Didn't find language client for " + ed.document.uri);
                return;
            }
            lc.sendRequest(ExecuteCommandRequest.type, { command, arguments: args });
        });
    })

    const extensionCmd = (cmdName: string) => async (ed, edit, ...args) => {
        const wf = await getSpagoRoot(ed.document);
        if (!wf) { return; }
        const cmds = commandCode.get(wf.fsPath);
        if (!cmds) {
            output.appendLine("Didn't find language client for " + ed.document.uri);
            return;
        }
        cmds[cmdName](args);
    }

    async function addClient(folder: Uri) {
        console.log("Add clients for ", folder.fsPath);



        if (!clients.has(folder.fsPath)) {
            try {
                output.appendLine("Launching new language client for " + folder.fsPath);
                const client = new LanguageClient('purescript', 'IDE PureScript', serverOptions, clientOptions(folder));

                client.onReady().then(async () => {
                    output.appendLine("Activated lc for " + folder.fsPath);
                    const cmds: ExtensionCommands = activatePS({ diagnosticsBegin, diagnosticsEnd, cleanBegin, cleanEnd }, client);
                    const cmdNames = await commands.getCommands();
                    commandCode.set(folder.fsPath, cmds);
                    Promise.all(Object.keys(cmds).map(async cmd => {
                        if (cmdNames.indexOf(cmd) === -1) {
                            commands.registerTextEditorCommand(cmd, extensionCmd(cmd));
                        }
                    }));
                }).catch(err => output.appendLine(err));

                client.start();
                clients.set(folder.fsPath, client);
            } catch (e) {
                output.appendLine(e);
            }
        }
    }

    async function didOpenTextDocument(document: TextDocument) {
        if ((!['purescript', 'javascript'].includes(document.languageId)) || document.uri.scheme !== 'file') {
            return;
        }

        // const folder = workspace.getWorkspaceFolder(document.uri);
        const folder = await getSpagoRoot(document)
        if (!folder) {
            output.appendLine("Didn't find workspace folder for " + document.uri);
            return;
        }
        addClient(folder);
    }

    workspace.onDidOpenTextDocument(didOpenTextDocument);
    workspace.textDocuments.forEach(didOpenTextDocument);
    // Todo
    // workspace.onDidChangeWorkspaceFolders((event) => {
    //     for (const folder of event.removed) {
    //         const client = clients.get(folder.fsPath);
    //         if (client) {
    //             clients.delete(folder.fsPath);
    //             client.stop();
    //         }
    //     }
    // });
    // if (clients.size == 0) {
    //     if (workspace.workspaceFolders && workspace.workspaceFolders.length == 1) {
    //         output.appendLine("Only one folder in workspace, starting language server");
    //         // The extension must be activated because there are Purs files in there
    //         // Todo
    //         // addClient(workspace.workspaceFolders[0]);
    //     } else if (workspace.workspaceFolders && workspace.workspaceFolders.length > 1) {
    //         output.appendLine("More than one folder in workspace, open a PureScript file to start language server");
    //     } else if (!workspace.workspaceFolders) {
    //         output.appendLine("It looks like you've started VS Code without specifying a folder, ie from a language extension development environment. Open a PureScript file to start language server.");
    //     }
    // }
    return { registerMiddleware, unregisterMiddleware, setDiagnosticsBegin, setDiagnosticsEnd, setCleanBegin, setCleanEnd }
}


export function deactivate(): Thenable<void> {
    let promises: Thenable<void>[] = [];
    for (let client of Array.from(clients.values())) {
        promises.push(client.stop());
    }
    return Promise.all(promises).then(() => undefined);
}



async function findSpagoRoot(output: OutputChannel, fileUri: Uri) {
    const root = await findSpagoRootRec(fileUri);
    if (root) {
        output.appendLine("Found spago.dhall at " + root)
    } else {
        output.appendLine("No spago.dhall found.")
    }

    return root
}

async function findSpagoRootRec(currentUri: Uri): Promise<Uri | null> {
    // Get dir of file
    const dir = path.dirname(currentUri.fsPath)
    console.log("dir: ", dir)

    // Create uri for dir 
    const uri = Uri.file(dir)
    console.log("uri.fsPath: ", uri.fsPath)
    const files = await workspace.fs.readDirectory(uri);

    // Iterate over files looking for spago.dhall
    for (const [file, fileType] of files) {
        console.log("file: ", file)

        // Todo: make configurable
        if (file === "spago.dhall") {
            return uri
        }
    }

    // Use workspace root as abort condition
    const wf = workspace.getWorkspaceFolder(currentUri)
    if (dir === wf.uri.fsPath) {
        return null
    } else {
        // If none found, try with next parent folder
        return findSpagoRootRec(uri)
    }
}