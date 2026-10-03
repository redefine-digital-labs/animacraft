import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils';
import { NATIVE_SOUL_KIOSK_DEPENDENCY as KIOSK } from '../scripts/native-soul-source-cas.mjs';
import { certifyMainnetV8PackagePublish } from '../scripts/mainnet-v8-release.mjs';
import { deriveMainnetV8SoulidityKioskOrigins,
  certifyMainnetV8SoulidityInitialization, mainnetV8TypedDigest, MAINNET_V8_PUBLISH_ORDER,
  MAINNET_V8_ROLE_ORDER, MAINNET_V8_RELEASE_SIGNER,
  buildMainnetV8OutcomeEvidence, sha256MainnetV8Bytes, sha256MainnetV8Json } from '../scripts/mainnet-v8-release-lib.mjs';
import { id, nativeSoulPublicationCertificateFixture as fixture,
  nativeSoulPublicationOutcomeFixture as outcomeFixture } from './fixtures/native-soul-publication-certificate-fixture.mjs';

test('approved-compiler own datatype bytecode passes the actual outcome entry with its existing fresh origin', async () => {
  const { input } = await outcomeFixture({ role: 'core', ownDatatype: true });
  const source = fromBase64(input.observation.packageArtifact.modules[0].bytesBase64);
  assert.equal(source.length, 127);
  assert.equal(sha256MainnetV8Bytes(source), 'e75e46f8c6c7eb942942c8b1c80f75a19bc31789924a960696325d37ecb1c7b7');
  const result = buildMainnetV8OutcomeEvidence(input);
  const pkg = result.observation.details.certificate.readback.package;
  assert.deepEqual(pkg.typeOrigins, [{ moduleName: 'sample', datatypeName: 'Sample', package: pkg.reference.objectId }]);
  assert.equal(pkg.abiArtifact.modules[0].datatypes.length, 1);
  assert.equal(pkg.abiArtifact.modules[0].datatypes[0].name, 'Sample');
  assert.equal(pkg.abiArtifact.modules[0].datatypes[0].fields[0].name, 'value');
  assert.equal(pkg.abiArtifact.modules[0].functions[0].name, 'value');
});

for (const replacement of [id(999), KIOSK.original]) test(`same-count existing own datatype cannot move its origin to ${replacement}`, async () => {
  const { input: validInput } = await outcomeFixture({ role: 'core', ownDatatype: true });
  // Positive control uses this identical full outcome before the one semantic
  // substitution. This is not an extra-row/count or absent-datatype rejection.
  assert.doesNotThrow(() => buildMainnetV8OutcomeEvidence(validInput));
  const input = structuredClone(validInput);
  const c = input.observation.certificate, pkg = c.readback.package;
  const metadata = structuredClone(pkg.descriptor), abi = structuredClone(input.observation.abiArtifact);
  const original = bcs.Object.parse(fromBase64(pkg.objectBcsBase64));
  const changed = bcs.Object.parse(fromBase64(pkg.objectBcsBase64));
  changed.data.Package.typeOriginTable[0].package = replacement;
  pkg.typeOrigins[0].package = replacement;
  assert.equal(changed.data.Package.typeOriginTable.length, original.data.Package.typeOriginTable.length);
  assert.deepEqual(changed.data.Package.moduleMap, original.data.Package.moduleMap);
  assert.deepEqual(pkg.typeOrigins.map(({ moduleName, datatypeName }) => [moduleName, datatypeName]), [['sample', 'Sample']]);
  const objectBytes = bcs.Object.serialize(changed).toBytes();
  pkg.objectBcsBase64 = toBase64(objectBytes); pkg.objectBcsSha256 = sha256MainnetV8Bytes(objectBytes);
  pkg.reference.digest = mainnetV8TypedDigest('Object', objectBytes);
  const effects = bcs.TransactionEffects.parse(fromBase64(c.finalityEvidence.effectsBcsBase64));
  const write = effects.V2.changedObjects.find(([objectId]) => objectId === pkg.reference.objectId);
  assert.ok(write[1].outputState.PackageWrite);
  write[1].outputState.PackageWrite[1] = pkg.reference.digest;
  const effectsBytes = bcs.TransactionEffects.serialize(effects).toBytes();
  Object.assign(c.finalityEvidence, { effectsBcsBase64: toBase64(effectsBytes), effectsSha256: sha256MainnetV8Bytes(effectsBytes),
    effectsDigest: mainnetV8TypedDigest('TransactionEffects', effectsBytes) });
  c.finalityEvidenceSha256 = sha256MainnetV8Json(c.finalityEvidence);
  c.readbackSha256 = sha256MainnetV8Json(c.readback);
  input.observation.certificateSha256 = sha256MainnetV8Json(c);
  assert.deepEqual(pkg.descriptor, metadata); assert.deepEqual(input.observation.abiArtifact, abi);
  assert.throws(() => buildMainnetV8OutcomeEvidence(input), error => {
    assert.equal(error.code, 'MAINNET_V8_WAL_EVIDENCE_INVALID');
    assert.match(error.message, /typeOrigins differ from exact fresh-package ABI definitions/);
    return true;
  });
});

for (const role of ['core', 'soulidity']) test(`optional ${role} publication identities remain fully certified and do not alter defaults`, async () => {
  const options = { role, packageId: id(4000), objectIdBase: 2000, protocolConfigId: id(3000), protocolAdminCapId: id(3001) };
  const { input } = await outcomeFixture(options);
  const result = buildMainnetV8OutcomeEvidence(input), readback = result.observation.details.certificate.readback;
  assert.equal(readback.package.reference.objectId, options.packageId);
  assert.equal(readback.upgradeCap.reference.objectId, id(2000));
  if (role === 'core') {
    assert.equal(readback.protocolConfig.reference.objectId, options.protocolConfigId);
    assert.equal(readback.protocolAdminCap.reference.objectId, options.protocolAdminCapId);
  } else {
    assert.equal(readback.soulidityInitialization.packageId, options.packageId);
    assert.equal(Object.keys(readback.soulidityInitialization.objects).length, 32);
  }
  const defaultFixture = fixture(role);
  assert.equal(defaultFixture.args.packageId, id(1000));
  assert.equal(defaultFixture.args.moveOutputs[0].reference.objectId, id(10));
});

test('actual live publication certifier and cold validator both execute exact Soulidity init proof', async () => {
  const f = fixture(), result = await certifyMainnetV8PackagePublish(f.input);
  assert.equal(result.role, 'soulidity'); assert.equal(result.protocolConfig, null); assert.equal(result.protocolAdminCap, null);
  assert.equal(Object.keys(result.soulidityInitialization.objects).length, 32);
  assert.equal(result.soulidityInitialization.ids.marketConfigV2Id, f.records.get('marketConfigV2').value.id);
  assert.deepEqual(deriveMainnetV8SoulidityKioskOrigins(result.package), f.args.kioskTypeOrigins);
  assert.equal(f.cold(JSON.parse(JSON.stringify(result))).transactionDigest, f.input.finalityEvidence.digest);
  assert.deepEqual(f.reads.filter(r => r.objectId === KIOSK.callable), [{ objectId: KIOSK.callable, version: '3', kind: 'historical' }]);
  assert.equal(MAINNET_V8_ROLE_ORDER.length, 7); assert.equal(MAINNET_V8_PUBLISH_ORDER.length, 8);
});
for (const role of ['seal', 'runtime', 'output', 'physical', 'market', 'release']) test(`unchanged two-output ${role} publication has null Soulidity init and cold validates`, async () => {
  const f = fixture(role), result = await certifyMainnetV8PackagePublish(f.input);
  assert.equal(result.soulidityInitialization, null); f.cold(JSON.parse(JSON.stringify(result)));
  assert.throws(() => f.cold({ ...result, soulidityInitialization: {} }));
});
test('Core retains its exact four-output initialization and commitment check', async () => {
  const f = fixture('core'), result = await certifyMainnetV8PackagePublish(f.input);
  assert.equal(result.soulidityInitialization, null); assert.equal(result.protocolConfig.reference.objectId, id(700));
  assert.equal(result.protocolAdminCap.reference.objectId, id(701)); f.cold(JSON.parse(JSON.stringify(result)));
  const invalid = JSON.parse(JSON.stringify(result)); invalid.protocolConfig.fields.enabled = true;
  assert.throws(() => f.cold(invalid));
});
for (const [name, change] of [
  ['opened primary gate', f => f.mutate('marketConfigV2', v => { v.primary_enabled = true; })],
  ['wrong rule config', f => f.mutate('soulRule1', v => { v.value = false; })],
  ['wrong creator display', f => f.mutate('collectionDisplay', v => { v.fields.contents[3].value = '{name}'; })],
  ['name index substitution', f => f.mutate('kindName1', v => { v.value = 3; })],
  ['DF ID substitution', f => f.mutate('kind0', v => { v.id = id(999); })],
]) test(`live exact reader rejects rehashed ${name}`, async () => {
  const f = fixture(); change(f); f.setEffects(f.effects()); await assert.rejects(() => certifyMainnetV8PackagePublish(f.input));
});
for (const [name, change] of [
  ['missing init', r => { delete r.soulidityInitialization; }],
  ['altered export ID', r => { r.soulidityInitialization.ids.marketConfigV2Id = id(999); }],
  ['altered decoded config', r => { r.soulidityInitialization.decoded.marketConfigV2.primary_enabled = true; }],
  ['missing field evidence', r => { delete r.soulidityInitialization.objects.kind0; }],
  ['duplicated upgrade evidence', r => { r.soulidityInitialization.objects.upgradeCap.reference.objectId = id(999); }],
  ['wrong transaction', r => { r.soulidityInitialization.objects.kind0.previousTransaction = toBase58(new Uint8Array(32).fill(9)); }],
  ['Core output claimed', r => { r.protocolConfig = r.upgradeCap; }],
  ['wrong role ordinal', r => { r.role = 'release'; }],
  ['dependency missing', r => { r.package.dependencyPackages = []; }],
  ['dependency raw bytes missing', r => { delete r.package.dependencyPackages[0].objectBcsBase64; }],
  ['dependency hash mismatch', r => { r.package.dependencyPackages[0].reference.digest = r.transactionDigest; }],
]) test(`cold certificate replay rejects ${name}`, async () => {
  const f = fixture(), result = JSON.parse(JSON.stringify(await certifyMainnetV8PackagePublish(f.input))); change(result); assert.throws(() => f.cold(result));
});
for (const [name, change] of [
  ['missing Config origin', pkg => { pkg.typeOriginTable = pkg.typeOriginTable.filter(r => r.datatypeName !== 'Config'); }],
  ['duplicate Rule origin', pkg => { pkg.typeOriginTable.push(pkg.typeOriginTable[1]); }],
  ['unknown Config origin', pkg => { pkg.typeOriginTable[0].package = id(999); }],
  ['missing rule module', pkg => { pkg.moduleMap.delete('personal_kiosk_rule'); }],
]) test(`exact historical dependency rejects rehashed ${name}`, async () => {
  const f = fixture(), result = JSON.parse(JSON.stringify(await certifyMainnetV8PackagePublish(f.input)));
  const evidence = result.package.dependencyPackages[0], object = bcs.Object.parse(fromBase64(evidence.objectBcsBase64)); change(object.data.Package);
  const raw = bcs.Object.serialize(object).toBytes(); evidence.objectBcsBase64 = toBase64(raw); evidence.reference.digest = mainnetV8TypedDigest('Object', raw);
  assert.throws(() => f.cold(result));
});
test('common live/cold init guard binds every output to finality, not merely one internal transaction', async () => {
  const f = fixture(), r = await certifyMainnetV8PackagePublish(f.input);
  const wrong = toBase58(new Uint8Array(32).fill(99));
  assert.throws(() => certifyMainnetV8SoulidityInitialization({ packageCertificate: { ...r.package, transactionDigest: wrong },
    writes: f.args.created, moveOutputs: f.args.moveOutputs, signer: f.args.signer, transactionDigest: wrong }));
});
for (const name of ['extra-created', 'mutated-input', 'wrong-finality']) test(`live effects boundary rejects ${name}`, async () => {
  const f = fixture(), effect = f.effects();
  if (name === 'wrong-finality') effect.V2.transactionDigest = toBase58(new Uint8Array(32).fill(99));
  else {
    const row = structuredClone(effect.V2.changedObjects[1]); row[0] = id(999);
    if (name === 'mutated-input') row[1].idOperation = { None: true };
    effect.V2.changedObjects.push(row);
  }
  f.setEffects(effect); await assert.rejects(() => certifyMainnetV8PackagePublish(f.input));
});
for (const name of ['wrong-effect-transaction', 'failed-status', 'trailing-effects']) test(`cold canonical effects boundary rejects ${name}`, async () => {
  const f = fixture(), result = await certifyMainnetV8PackagePublish(f.input), effects = f.effects();
  if (name === 'wrong-effect-transaction') effects.V2.transactionDigest = toBase58(new Uint8Array(32).fill(99));
  if (name === 'failed-status') effects.V2.status = { Failure: { error: { InsufficientGas: true }, command: null } };
  f.setEffects(effects);
  if (name === 'trailing-effects') f.input.finalityEvidence.effectsBcsBase64 = toBase64(Buffer.concat([fromBase64(f.input.finalityEvidence.effectsBcsBase64), Buffer.from([0])]));
  assert.throws(() => f.cold(result));
});


test('actual outcome builder passes verified TransactionData sender through finality into Soulidity cold readback', async () => {
  const { input } = await outcomeFixture();
  const result = buildMainnetV8OutcomeEvidence(input);
  assert.equal(result.observation.details.certificate.readback.role, 'soulidity');
  assert.equal(result.signedArtifact.signer, MAINNET_V8_RELEASE_SIGNER);
  assert.equal(result.observation.details.certificate.readback.soulidityInitialization.decoded.marketConfigV2.fee_recipient, MAINNET_V8_RELEASE_SIGNER);
});
test('actual outcome builder rejects init/export tampering even after certificate hashes are refreshed', async () => {
  const fixture = await outcomeFixture();
  for (const key of ['kindRegistryId', 'profileRegistryId', 'socialRegistryId', 'communityRegistryId', 'communityVoteRegistryId']) {
    const input = JSON.parse(JSON.stringify(fixture.input));
    const certificate = input.observation.certificate;
    certificate.readback.soulidityInitialization.ids[key] = id(999);
    certificate.readbackSha256 = sha256MainnetV8Json(certificate.readback);
    input.observation.certificateSha256 = sha256MainnetV8Json(certificate);
    assert.throws(() => buildMainnetV8OutcomeEvidence(input), /stored init\/export map/);
  }
});
test('actual outcome never derives signer from consistently substituted output owners', async () => {
  const { input } = await outcomeFixture({ outputOwner: id(999) });
  assert.throws(() => buildMainnetV8OutcomeEvidence(input), /upgradeCap type or signer owner is invalid/);
});
for (const role of MAINNET_V8_PUBLISH_ORDER) test(`shared ${role} outcome follows its exact eight-package ordinal and cold certificate`, async () => {
  const { input, details } = await outcomeFixture({ role });
  assert.equal(input.ordinal, String(MAINNET_V8_PUBLISH_ORDER.indexOf(role)));
  assert.equal(input.observation, details);
  assert.equal(details.packageArtifact.role, role);
  assert.equal(details.certificate.readback.role, role);
  const evidence = buildMainnetV8OutcomeEvidence(JSON.parse(JSON.stringify(input)));
  const readback = evidence.observation.details.certificate.readback;
  assert.equal(readback.role, role);
  if (role === 'core') {
    assert.equal(readback.protocolConfig.reference.objectId, id(700));
    assert.equal(readback.protocolAdminCap.reference.objectId, id(701));
    assert.equal(readback.protocolConfig.fields.enabled, false);
    assert.equal(readback.protocolAdminCap.owner.AddressOwner, MAINNET_V8_RELEASE_SIGNER);
  } else {
    assert.equal(readback.protocolConfig, null); assert.equal(readback.protocolAdminCap, null);
  }
  if (role === 'soulidity') assert.equal(Object.keys(readback.soulidityInitialization.objects).length, 32);
  else assert.equal(readback.soulidityInitialization, null);
});
