import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function functionSource(name) {
  const declaration = `function ${name}`;
  const declarationIndex = appSource.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `missing ${name}`);
  const bodyStart = appSource.indexOf(') {', declarationIndex + declaration.length) + 2;
  assert.ok(bodyStart > 1, `missing ${name} body`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const character = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      return appSource.slice(declarationIndex, index + 1);
    }
  }
  assert.fail(`unterminated ${name}`);
}

function completionGateHarness() {
  return new Function(`
    const state = {
      makerDocumentV4: {
        version: { versionId: 'maker-version-current' },
        metadata: {
          name: 'Completion Gate Maker',
          style: 'Moonlit',
        },
        livingContent: {
          soulMd: '# Maker Soul',
          memoryMd: '# Maker Memory',
          skillMd: '---\\nname: maker-skill\\n---\\n# Maker Skill',
        },
        defaultRecipe: { selections: [], colors: [] },
      },
      makerRecipeV4: { selections: [], colors: [] },
      playerRecipeV4: { selections: [], colors: [] },
      playerCompletionSnapshotV4: null,
      playerRuntimeDocumentV4: null,
      playerProfileV4: null,
    };
    const isMakerV4Document = (document) => Boolean(document?.version?.versionId);
    const t = (key) => key === 'completeOcBeforePublishing'
      ? 'Complete this OC before publishing.'
      : key;
    const v4ProfileFromLegacy = () => ({
      name: 'Legacy profile',
      world: 'Legacy world',
      description: '',
      tags: '',
    });
    const splitList = (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
    const soulidityContentManifest = (content) => ({ content: structuredClone(content) });
    const activeMakerObjectId = () => '0xmaker';
    const activeTemplate = () => ({ quiltId: 'quilt-id' });
    const buildMakerV4OcPackage = (value) => ({
      package: {
        makerVersionId: value.document.version.versionId,
        recipe: structuredClone(value.recipe),
        profile: structuredClone(value.profile),
        livingContent: structuredClone(value.livingContent),
      },
    });
    const createPlayerCompletionSnapshot = ({
      document,
      recipe,
      profile,
      livingContent,
      imageBlob,
      imageExport,
    }) => ({
      makerVersionId: document.version.versionId,
      recipe: structuredClone(recipe),
      profile: structuredClone(profile),
      livingContent: structuredClone(livingContent),
      imageBlob,
      imageExport: structuredClone(imageExport),
    });
    const syncLegacyVisualFromV4 = () => {};
    const invalidateOcUpload = () => {};
    const $ = () => null;
    const playerComposableV6TrustedSnapshot = null;
    ${functionSource('currentMakerV4OcBundle')}
    ${functionSource('playerComposableV6CompletionState')}
    ${functionSource('syncPlayerV4State')}
    return {
      state,
      currentMakerV4OcBundle,
      syncPlayerV4State,
    };
  `)();
}

function assertCompletionRequired(run) {
  assert.throws(
    run,
    (error) => (
      error?.code === 'OC_COMPLETION_REQUIRED'
      && error.message === 'Complete this OC before publishing.'
    ),
  );
}

test('OC publication gate executes fail-closed for missing and wrong-version completion snapshots', () => {
  const harness = completionGateHarness();

  assertCompletionRequired(() => harness.currentMakerV4OcBundle({ requireCompletion: true }));

  harness.state.playerCompletionSnapshotV4 = {
    makerVersionId: 'maker-version-old',
    recipe: { selections: [{ partId: 'old' }], colors: [] },
    profile: { name: 'Old OC' },
    livingContent: {
      soulMd: '# Old Soul',
      memoryMd: '# Old Memory',
      skillMd: '---\nname: old\n---\n# Old Skill',
    },
  };
  assertCompletionRequired(() => harness.currentMakerV4OcBundle({ requireCompletion: true }));
});

test('any live Player update invalidates a completed OC before publication can build a package', () => {
  const harness = completionGateHarness();
  const completedPayload = {
    document: harness.state.makerDocumentV4,
    recipe: {
      selections: [{ partId: 'hair', itemId: 'black', styleId: 'long' }],
      colors: [],
    },
    profile: {
      name: 'Mira',
      world: 'Moonlit',
      description: 'Completed identity',
      tags: 'moon, courier',
    },
    livingContent: {
      soulMd: '# Mira',
      memoryMd: '# Mira Memory',
      skillMd: '---\nname: mira\n---\n# Mira Skill',
    },
    imageBlob: new Blob(['reviewed-png'], { type: 'image/png' }),
    imageExport: {
      sizeMode: 'standard',
      transparentBackground: false,
      width: 1024,
      height: 1024,
      mediaType: 'image/png',
    },
  };

  harness.syncPlayerV4State(completedPayload, { completed: true });
  const completed = harness.currentMakerV4OcBundle({ requireCompletion: true });
  assert.equal(completed.package.profile.name, 'Mira');
  assert.equal(completed.package.recipe.selections[0].itemId, 'black');
  assert.equal(completed.package.livingContent.content.memoryMd, '# Mira Memory');
  assert.equal(harness.state.playerCompletionSnapshotV4.imageBlob, completedPayload.imageBlob);
  assert.notEqual(harness.state.playerCompletionSnapshotV4.imageExport, completedPayload.imageExport);
  assert.deepEqual(harness.state.playerCompletionSnapshotV4.imageExport, completedPayload.imageExport);

  harness.syncPlayerV4State({
    ...completedPayload,
    profile: {
      ...completedPayload.profile,
      description: 'Edited after Complete OC',
    },
  });
  assert.equal(harness.state.playerCompletionSnapshotV4, null);
  assertCompletionRequired(() => harness.currentMakerV4OcBundle({ requireCompletion: true }));
});
