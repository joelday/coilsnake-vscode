import { SyntaxTree } from './src/syntaxTree';
import { SyntaxKind } from './src/syntax/syntaxKind';

const source = '"Text position:" text_pos(10, 1)';
const tree = SyntaxTree.parse(source);

function printTree(node: any, indent = 0) {
    const prefix = '  '.repeat(indent);
    const kindName = SyntaxKind[node.kind];
    
    if (node.isToken && node.isToken()) {
        const text = node.text || '';
        console.log(`${prefix}${kindName}: "${text}"`);
        
        const leading = node.getLeadingTrivia();
        const trailing = node.getTrailingTrivia();
        if (leading.length > 0) {
            console.log(`${prefix}  LeadingTrivia: ${leading.length} items`);
        }
        if (trailing.length > 0) {
            console.log(`${prefix}  TrailingTrivia: ${trailing.length} items`);
        }
    } else {
        console.log(`${prefix}${kindName} [${node.position}..${node.position + node.fullWidth})`);
    }
    
    const children = node.getChildren();
    for (const child of children) {
        printTree(child, indent + 1);
    }
}

printTree(tree.getRoot());

const diagnostics = tree.getDiagnostics();
if (diagnostics.length > 0) {
    console.log('\nDiagnostics:');
    diagnostics.forEach((d: any) => console.log(`  ${d.message} at ${d.start}`));
}
