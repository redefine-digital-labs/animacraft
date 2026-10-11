const MAX_ERROR_DETAIL_LENGTH = 8_000;

function errorTextCandidates(error, seen = new Set()) {
  if (error == null || seen.has(error)) return [];
  if (typeof error === 'string') return [error];
  if (typeof error !== 'object') return [String(error)];
  seen.add(error);
  const values = [
    error.code,
    error.name,
    error.message,
    error.shortMessage,
    error.details,
    error.reason,
  ];
  if (error.cause) values.push(...errorTextCandidates(error.cause, seen));
  if (error.error) values.push(...errorTextCandidates(error.error, seen));
  if (error.data) values.push(...errorTextCandidates(error.data, seen));
  return values.flatMap((value) => (
    typeof value === 'string' && value.trim() ? [value.trim()] : []
  ));
}

function normalizedDetails(error) {
  const unique = [...new Set(errorTextCandidates(error))];
  return unique.join('\n').slice(0, MAX_ERROR_DETAIL_LENGTH);
}

export function classifyChainUiError(error, {
  action = '',
  occurredAt = new Date().toISOString(),
} = {}) {
  const details = normalizedDetails(error) || 'Unknown chain error';
  const searchable = details.toLowerCase();
  let code = 'CHAIN_ACTION_FAILED';
  if (
    searchable.includes('upload_recovery_mismatch')
    || searchable.includes('saved upload no longer matches')
  ) {
    code = 'UPLOAD_RECOVERY_MISMATCH';
  } else if (
    searchable.includes('upload_quote_changed')
    || searchable.includes('relay quote changed')
    || searchable.includes('upload quote changed')
  ) {
    code = 'UPLOAD_QUOTE_CHANGED';
  } else if (
    searchable.includes('walrus_certification_not_visible')
    || /walrus certification[\s\S]*confirmed[\s\S]*certified blob object[\s\S]*not visible/i.test(details)
  ) {
    code = 'WALRUS_CERTIFICATION_NOT_VISIBLE';
  } else if (
    searchable.includes('transaction_outcome_pending')
    || searchable.includes('walrus_transaction_status_unknown')
    || searchable.includes('transaction outcome is still pending')
    || searchable.includes('transaction result is still unknown')
    || searchable.includes('transaction status is still unknown')
  ) {
    code = 'TRANSACTION_OUTCOME_PENDING';
  } else if (
    searchable.includes('tip_too_high')
    || /tip amount[\s\S]*exceeds (?:the )?maximum allowed tip/i.test(details)
  ) {
    code = 'TIP_TOO_HIGH';
  } else if (
    searchable.includes('insufficient_wal_balance')
    || /wallet has [\d,]+ frost[\s\S]*requires [\d,]+ frost/i.test(details)
  ) {
    code = 'INSUFFICIENT_WAL_BALANCE';
  } else if (
    searchable.includes('insufficient_sui_balance')
    || /wallet has [\d,]+ mist[\s\S]*relay tip requires [\d,]+ mist/i.test(details)
  ) {
    code = 'INSUFFICIENT_SUI_BALANCE';
  } else if (
    /user rejected|rejected by (?:the )?user|request rejected|user denied|cancelled by (?:the )?user/i.test(details)
  ) {
    code = 'WALLET_REJECTED';
  } else if (
    /insufficient (?:gas|balance)|not enough (?:gas|balance)|gas balance is too low/i.test(details)
  ) {
    code = 'INSUFFICIENT_GAS';
  } else if (
    /timed? out|network error|failed to fetch|load failed|connection (?:lost|closed|refused)/i.test(details)
  ) {
    code = 'NETWORK_UNAVAILABLE';
  }
  const diagnosticTitle = code === 'WALRUS_CERTIFICATION_NOT_VISIBLE'
    ? 'Animacraft chain state is still syncing'
    : 'Animacraft chain action failed';
  const diagnostic = [
    diagnosticTitle,
    `Code: ${code}`,
    action ? `Action: ${action}` : '',
    `Time: ${occurredAt}`,
    '',
    details,
  ].filter((line, index) => line || index === 4).join('\n');
  return {
    code,
    action: String(action || ''),
    occurredAt,
    details,
    diagnostic,
  };
}
