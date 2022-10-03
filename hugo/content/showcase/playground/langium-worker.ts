import { DocumentState, startLanguageServer, EmptyFileSystem, createLangiumGrammarServices } from 'langium';
import { createConnection, DiagnosticSeverity } from 'vscode-languageserver/browser';
import { ByPassingMessageReader, ByPassingMessageWriter, PlaygroundWrapper } from './common';

/* browser specific setup code */
const messageWrapper = new PlaygroundWrapper();
const messageReader = new ByPassingMessageReader(self, messageWrapper);
const messageWriter = new ByPassingMessageWriter(self, messageWrapper);

const connection = createConnection(messageReader, messageWriter);

// Inject the shared services and language-specific services
const { shared } = createLangiumGrammarServices({ connection, ...EmptyFileSystem });

// by pass other messages that are required to make the playground work
shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Parsed, () => messageWriter.byPassWrite({type: 'changing'}));
shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Validated, ([document]) => {
    const errors = (document.diagnostics ?? []).filter(d => d.severity === DiagnosticSeverity.Error);
    if (errors.length > 0) {
        return messageWriter.byPassWrite({
            type: 'error',
            errors
        });
    }
    thottlePassWrite(document.textDocument.getText());
    return Promise.resolve();
});

let timeout: NodeJS.Timeout | undefined;

function thottlePassWrite(text: string): void {
    if (timeout) {
        console.log('Timeout cleared')
        clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
        console.log('Timeout executed')
        messageWriter.byPassWrite({
            type: 'validated',
            grammar: text
        });
    }, 1000);
}

// Start the language server with the shared services
startLanguageServer(shared);