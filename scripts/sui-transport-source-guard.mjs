// SDK 2.26.2 exports ObjectError from its transport-neutral client/errors module.
// Permit only this exact static import; other client imports remain reviewed
// separately. This is a delivery lint, not a runtime permission boundary.
const objectErrorImport = /^[\t ]*import\s*\{\s*ObjectError\s*\}\s*from\s*(['"])@mysten\/sui\/client\1\s*;[\t ]*$/gm;
const forbiddenTransport = /@mysten\/sui\/(?:jsonrpc|client)|SuiJsonRpcClient|getJsonRpcFullnodeUrl|JsonRpcProvider|\b(?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)\s*\(|\[\s*["'](?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)["']\s*\]\s*\(/i;

export function hasForbiddenSuiTransportSource(contents) {
  return forbiddenTransport.test(contents.replace(objectErrorImport, ''));
}
