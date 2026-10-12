#!/usr/bin/env node
/**
 * CCScript Language Server
 *
 * LSP-compliant language server for CCScript that can be used
 * by any editor supporting the Language Server Protocol.
 */

import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { startServer } from './languageServer';

startServer(createConnection(ProposedFeatures.all));
