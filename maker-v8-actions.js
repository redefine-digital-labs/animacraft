/**
 * Canonical fresh-v8 Market action identities shared by Web, Recovery, and the
 * production browser adapter.  Only the exact camelCase action id and its
 * exact durable upper-case form are accepted; case folding is never used as
 * authority.
 */

const ACTION_ROWS = [
  ['listMakerControl', 'List Maker control', 'MAKER', 'LIST', 'buildListMakerControl', 'quoteMakerResale'],
  ['purchaseMakerControl', 'Purchase Maker control', 'MAKER', 'PURCHASE', 'buildPurchaseMakerControl', 'quoteMakerResale'],
  ['cancelMakerControl', 'Cancel Maker listing', 'MAKER', 'CANCEL', 'buildCancelMakerControl', 'quoteMakerResale'],
  ['recoverMakerControl', 'Recover Maker control', 'MAKER', 'RECOVER', 'buildRecoverMakerControl', 'quoteMakerResale'],
  ['listSoulBundle', 'List Soul bundle', 'SOUL', 'LIST', 'buildListSoulBundle', 'quoteSoulResale'],
  ['purchaseSoulBundle', 'Purchase Soul bundle', 'SOUL', 'PURCHASE', 'buildPurchaseSoulBundle', 'quoteSoulResale'],
  ['cancelSoulListing', 'Cancel Soul listing', 'SOUL', 'CANCEL', 'buildCancelSoulListing', 'quoteSoulResale'],
  ['recoverSoulListing', 'Recover Soul bundle', 'SOUL', 'RECOVER', 'buildRecoverSoulListing', 'quoteSoulResale'],
  ['listBasePhysical', 'List Base Physical', 'PHYSICAL_BASE', 'LIST', 'buildListBasePhysical', 'quotePhysicalResale'],
  ['listPackPhysical', 'List Pack Physical', 'PHYSICAL_PACK', 'LIST', 'buildListPackPhysical', 'quotePhysicalResale'],
  ['purchaseBasePhysical', 'Purchase Base Physical', 'PHYSICAL_BASE', 'PURCHASE', 'buildPurchaseBasePhysical', 'quotePhysicalResale'],
  ['purchasePackPhysical', 'Purchase Pack Physical', 'PHYSICAL_PACK', 'PURCHASE', 'buildPurchasePackPhysical', 'quotePhysicalResale'],
  ['cancelPhysicalListing', 'Cancel typed Physical listing', 'PHYSICAL', 'CANCEL', 'buildCancelPhysicalListing', 'quotePhysicalResale'],
  ['recoverPhysicalListing', 'Recover typed Physical listing', 'PHYSICAL', 'RECOVER', 'buildRecoverPhysicalListing', 'quotePhysicalResale'],
];

export const MAKER_V8_ACTIONS = Object.freeze(ACTION_ROWS.map(([
  id, label, lane, kind, builder, quote,
]) => Object.freeze({
  id,
  recoveryId: id.toUpperCase(),
  label,
  lane,
  lanes: Object.freeze(lane === 'PHYSICAL'
    ? ['PHYSICAL_BASE', 'PHYSICAL_PACK'] : [lane]),
  kind,
  builder,
  quote,
})));

const BY_PUBLIC_ID = new Map(MAKER_V8_ACTIONS.map((action) => [action.id, action]));
const BY_RECOVERY_ID = new Map(MAKER_V8_ACTIONS.map((action) => [action.recoveryId, action]));

export function makerV8ActionV8(value) {
  if (typeof value !== 'string') return null;
  return BY_PUBLIC_ID.get(value) ?? BY_RECOVERY_ID.get(value) ?? null;
}

export function makerV8CanonicalActionIdV8(value) {
  return makerV8ActionV8(value)?.id ?? null;
}

export function makerV8RecoveryActionIdV8(value) {
  return makerV8ActionV8(value)?.recoveryId ?? null;
}
