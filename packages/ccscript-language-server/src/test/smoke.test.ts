import { Hover } from 'vscode-languageserver-protocol';
import { TestClient, positionOf } from './testClient';

it('starts, publishes diagnostics and answers hover', async () => {
    const client = await TestClient.start({ files: { '/project/main.ccs': 'command main() { next nope }' } });
    try {
        await client.open('/project/main.ccs');
        const diagnostics = await client.waitForDiagnostics('/project/main.ccs');
        expect(diagnostics.map(d => d.message)).toEqual(["Undefined identifier 'nope'"]);
        const hover = await client.request<Hover>('textDocument/hover', '/project/main.ccs',
            positionOf(client.text('/project/main.ccs'), 'next'));
        expect(JSON.stringify(hover.contents)).toContain('Waits for a button press');
    } finally {
        client.dispose();
    }
});
