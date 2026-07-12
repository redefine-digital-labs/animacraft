import {
  collectMakerV4ValidationIssues,
  createMakerV4Document,
  isMakerV4Document,
  migrateMakerV3ToV4,
} from './maker-v4.js';
import { evaluateRecipe, generateValidRecipe, normalizeRecipe } from './maker-rules.js';
import {
  checkExpansionPackCompatibility,
  compareMakerCompatibility,
  EXPANSION_PACK_SCHEMA,
  mergeExpansionPacks,
} from './expansion-packs.js';
import { evaluateVisibleWhen, renderResolvedScene, resolveMakerScene } from './maker-renderer.js';
import { createMakerCommandStore } from './maker-command-store.js';
import {
  addDocumentAsset,
  createGradientColorChannel,
  createItem,
  createLayerBinding,
  createLayerTrack,
  createPart,
  createVariant,
  duplicatePart,
  findBinding,
  findItem,
  findPart,
  findVariant,
  moveArrayEntry,
  normalizeDocumentOrders,
  recipeSelectionMap,
  removeUnreferencedAssetMetadata,
  replaceRecipeSelection,
  synchronizeDefaultRecipe,
  uniqueDocumentId,
} from './maker-document-ops.js';
import {
  buildAssetImportMapping,
  createAlphaCroppedThumbnail,
  createAssetId,
  createCachedAssetResolver,
  inspectPngAsset,
  reviveRuntimeAssetRecord,
  revokeRuntimeAsset,
  runtimeAssetRecord,
} from './maker-assets.js';
import { createGradientColorProcessor } from './maker-color.js';
import {
  deleteMakerWorkspaceAssets,
  loadMakerWorkspaceAssets,
  loadMakerWorkspaceDocument,
  loadPlayerWorkspaceSession,
  saveMakerWorkspaceDocument,
  savePlayerWorkspaceSession,
  upsertMakerWorkspaceAssets,
} from './maker-workspace-store.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function checked(value) {
  return value ? 'checked' : '';
}

function selected(value, expected) {
  return String(value ?? '') === String(expected ?? '') ? 'selected' : '';
}

function clone(value) {
  return structuredClone(value);
}

function debounce(callback, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function safeFileName(value, fallback = 'asset') {
  return String(value || fallback)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || fallback;
}

function compactIssue(issue) {
  return {
    code: String(issue?.code || 'invalid'),
    path: String(issue?.path || ''),
    message: String(issue?.message || issue?.code || 'Invalid Maker data.'),
  };
}

function recipeWithColors(document, recipe) {
  const next = clone(recipe || { selections: [], colors: [] });
  next.selections ||= [];
  next.colors ||= [];
  document.colorChannels.forEach((channel) => {
    if (!next.colors.some((entry) => entry.channelId === channel.id) && channel.defaultSwatchId) {
      next.colors.push({ channelId: channel.id, swatchId: channel.defaultSwatchId });
    }
  });
  return next;
}

function partStatus(part) {
  const variants = part.items.reduce((count, item) => count + item.variants.length, 0);
  const bindings = part.items.reduce((count, item) => count + item.variants.reduce((sum, variant) => sum + variant.layerBindings.length, 0), 0);
  return `${part.items.length} items · ${variants} styles · ${bindings} layers`;
}

function ownerRuleRows(document) {
  const rows = [];
  document.parts.forEach((part) => {
    ['requires', 'excludes'].forEach((type) => (part[type] || []).forEach((target, index) => rows.push({
      id: `part:${part.id}:${type}:${index}`,
      ownerType: 'part',
      ownerPartId: part.id,
      ownerItemId: '',
      ownerVariantId: '',
      ownerName: part.name,
      type,
      target,
      index,
    })));
    part.items.forEach((item) => {
      ['requires', 'excludes'].forEach((type) => (item[type] || []).forEach((target, index) => rows.push({
        id: `item:${part.id}:${item.id}:${type}:${index}`,
        ownerType: 'item',
        ownerPartId: part.id,
        ownerItemId: item.id,
        ownerVariantId: '',
        ownerName: `${part.name} / ${item.name}`,
        type,
        target,
        index,
      })));
      item.variants.forEach((variant) => {
        ['requires', 'excludes'].forEach((type) => (variant[type] || []).forEach((target, index) => rows.push({
          id: `variant:${part.id}:${item.id}:${variant.id}:${type}:${index}`,
          ownerType: 'variant',
          ownerPartId: part.id,
          ownerItemId: item.id,
          ownerVariantId: variant.id,
          ownerName: `${part.name} / ${item.name} / ${variant.name}`,
          type,
          target,
          index,
        })));
      });
    });
  });
  return rows;
}

function defaultExpansion(document, index) {
  const packId = uniqueDocumentId(`expansion-${index + 1}`, [document.extensions?.expansionDrafts || []], 'expansion');
  return {
    schemaVersion: EXPANSION_PACK_SCHEMA,
    packId,
    namespace: `pack${index + 1}`,
    name: `Expansion ${index + 1}`,
    version: '1.0.0',
    baseMakerId: document.version.rootMakerId,
    baseVersion: String(document.version.number),
    layerTracks: [],
    colorChannels: [],
    assets: [],
    parts: [],
    rules: [],
  };
}

export class MakerWorkspace {
  constructor(options = {}) {
    this.creatorRoot = options.creatorRoot || null;
    this.playerRoot = options.playerRoot || null;
    this.callbacks = options.callbacks || {};
    this.context = null;
    this.store = null;
    this.unsubscribe = null;
    this.assets = new Map();
    this.assetResolver = createCachedAssetResolver(this.assets);
    this.applyColorChannel = createGradientColorProcessor();
    this.creatorTab = 'structure';
    this.selectedPartId = '';
    this.selectedItemId = '';
    this.selectedVariantId = '';
    this.selectedBindingId = '';
    this.selectedTrackId = '';
    this.selectedChannelId = '';
    this.playerPartId = '';
    this.playerRecipe = { selections: [], colors: [] };
    this.playerUndo = [];
    this.playerRedo = [];
    this.playerProfile = { name: 'Untitled OC', world: '', description: '', tags: '' };
    this.playerIntroOpen = false;
    this.enabledExpansionIds = new Set();
    this.pendingImport = null;
    this.creatorZoom = 1;
    this.creatorSolo = false;
    this.creatorDimOthers = true;
    this.hiddenBindingIds = new Set();
    this.dragPreview = null;
    this.bindingScalePreview = null;
    this.dragSort = null;
    this.renderAbort = { creator: null, player: null };
    this.autosave = debounce(() => this.save({ automatic: true }), 850);
    this.sessionAutosave = debounce(() => this.savePlayerSession(), 500);
    this.boundCreatorClick = (event) => this.handleCreatorClick(event);
    this.boundCreatorChange = (event) => {
      Promise.resolve(this.handleCreatorChange(event)).catch((error) => {
        const message = error.message || 'The selected Maker asset could not be imported.';
        this.store?.setSaveState('error', message);
        this.callbacks.onCreatorError?.(error);
      });
    };
    this.boundCreatorInput = (event) => this.handleCreatorInput(event);
    this.boundPlayerClick = (event) => this.handlePlayerClick(event);
    this.boundPlayerChange = (event) => this.handlePlayerChange(event);
    this.attachRootListeners();
    this.renderEmpty();
  }

  attachRootListeners() {
    if (this.creatorRoot) {
      this.creatorRoot.addEventListener('click', this.boundCreatorClick);
      this.creatorRoot.addEventListener('change', this.boundCreatorChange);
      this.creatorRoot.addEventListener('input', this.boundCreatorInput);
      this.creatorRoot.addEventListener('dragstart', (event) => this.handleDragStart(event));
      this.creatorRoot.addEventListener('dragover', (event) => this.handleDragOver(event));
      this.creatorRoot.addEventListener('drop', (event) => this.handleDrop(event));
    }
    if (this.playerRoot) {
      this.playerRoot.addEventListener('click', this.boundPlayerClick);
      this.playerRoot.addEventListener('change', this.boundPlayerChange);
      this.playerRoot.addEventListener('input', this.boundPlayerChange);
    }
  }

  renderEmpty() {
    const copy = '<div class="v4-empty"><strong>Select or create a Maker</strong><span>The v4 editor will load its Parts, Items, styles and layers here.</span></div>';
    if (this.creatorRoot) this.creatorRoot.innerHTML = copy;
    if (this.playerRoot) this.playerRoot.innerHTML = copy;
  }

  get makerKey() {
    return String(this.context?.makerKey || '');
  }

  get playerSessionKey() {
    const wallet = String(this.context?.walletAddress || 'wallet');
    const version = String(this.runtimeDocument()?.version?.versionId || this.context?.versionId || this.makerKey);
    return `${wallet}::${version}`;
  }

  runtimeAsset(assetId) {
    const direct = this.assets.get(assetId);
    if (direct) return direct;
    const separator = String(assetId || '').indexOf('__');
    if (separator > 0) return this.assets.get(String(assetId).slice(separator + 2)) || null;
    return null;
  }

  runtimeDocument() {
    if (!this.store) return null;
    const document = this.store.getState().document;
    const drafts = document.extensions?.expansionDrafts || [];
    const enabled = drafts.filter((pack) => this.enabledExpansionIds.has(pack.packId));
    if (!enabled.length) return document;
    const result = mergeExpansionPacks(document, enabled, { returnResult: true });
    return result.compatible ? result.maker : document;
  }

  normalizeDocument(document) {
    document.extensions ||= {};
    document.extensions.expansionDrafts ||= [];
    document.layerTracks ||= [];
    document.colorChannels ||= [];
    document.parts ||= [];
    document.assets ||= [];
    document.expansionPacks ||= [];
    normalizeDocumentOrders(document);
    synchronizeDefaultRecipe(document);
    return document;
  }

  async setContext(context) {
    if (!context?.makerKey) {
      this.context = null;
      this.renderEmpty();
      return;
    }
    const sameMaker = this.context?.makerKey === context.makerKey;
    this.context = { ...this.context, ...context };
    if (sameMaker && this.store) {
      this.render();
      return;
    }
    this.unsubscribe?.();
    this.assetResolver.clear();
    this.assets.forEach(revokeRuntimeAsset);
    this.assets = new Map();
    this.assetResolver = createCachedAssetResolver(this.assets);

    let document;
    try {
      document = isMakerV4Document(context.document)
        ? clone(context.document)
        : context.document
          ? migrateMakerV3ToV4(context.document)
          : createMakerV4Document({ makerId: context.makerKey, name: context.name || 'Untitled Maker', creator: context.creator || '' });
    } catch (error) {
      document = createMakerV4Document({ makerId: context.makerKey, name: context.name || 'Recovered Maker', creator: context.creator || '' });
      document.extensions.migrationError = error.message;
    }
    this.normalizeDocument(document);
    (context.assets || []).forEach((record) => {
      const assetId = String(record.assetId || record.id || record.identifier || '');
      if (!assetId) return;
      const revived = record.url || record.thumbnailUrl
        ? { ...record, assetId }
        : reviveRuntimeAssetRecord({ ...record, assetId, blob: record.blob || record.file });
      this.assets.set(assetId, revived);
    });
    document.assets.forEach((descriptor) => {
      if (this.assets.has(descriptor.id)) return;
      const supplied = (context.assets || []).find((asset) => [asset.id, asset.assetId, asset.identifier].includes(descriptor.id)
        || asset.identifier === descriptor.identifier);
      if (supplied) {
        const blob = supplied.blob || supplied.file;
        this.assets.set(descriptor.id, supplied.url
          ? { ...supplied, assetId: descriptor.id, blob }
          : reviveRuntimeAssetRecord({ ...supplied, assetId: descriptor.id, blob }));
      } else if (descriptor.url || descriptor.legacy?.url) {
        this.assets.set(descriptor.id, {
          assetId: descriptor.id,
          url: descriptor.url || descriptor.legacy.url,
          thumbnailUrl: descriptor.thumbnailUrl || '',
          width: descriptor.width,
          height: descriptor.height,
          identifier: descriptor.identifier,
          source: 'remote',
        });
      }
    });
    const recipe = recipeWithColors(document, context.recipe || document.defaultRecipe);
    this.store = createMakerCommandStore(document, recipe);
    this.unsubscribe = this.store.subscribe((next, event) => {
      this.ensureCreatorSelection(next.document);
      this.render();
      if (event.reason !== 'replace' && event.reason !== 'save-state') {
        this.callbacks.onDocumentChange?.({ document: next.document, recipe: next.recipe, assets: this.assets, event });
        this.autosave();
      }
    });
    this.ensureCreatorSelection(document);
    this.playerRecipe = recipeWithColors(document, context.playerRecipe || document.defaultRecipe);
    this.playerPartId = document.parts.find((part) => part.menuVisible)?.id || document.parts[0]?.id || '';
    this.playerProfile = {
      name: context.profile?.name || 'Untitled OC',
      world: context.profile?.world || document.metadata.style || '',
      description: context.profile?.description || '',
      tags: context.profile?.tags || '',
    };
    this.playerUndo = [];
    this.playerRedo = [];
    this.playerIntroOpen = true;
    this.render();
    await this.restoreLocalWorkspace();
  }

  async restoreLocalWorkspace() {
    if (!this.makerKey || !this.context?.walletAddress) return;
    const requestedMakerKey = this.makerKey;
    try {
      const [saved, storedAssets, playerSession] = await Promise.all([
        loadMakerWorkspaceDocument(requestedMakerKey),
        loadMakerWorkspaceAssets(requestedMakerKey),
        loadPlayerWorkspaceSession(this.playerSessionKey),
      ]);
      if (this.context?.makerKey !== requestedMakerKey) return;
      storedAssets.forEach((record) => {
        const previous = this.assets.get(record.assetId);
        if (previous) revokeRuntimeAsset(previous);
        this.assets.set(record.assetId, reviveRuntimeAssetRecord(record));
      });
      this.assetResolver.clear();
      this.assetResolver = createCachedAssetResolver(this.assets);
      if (saved?.document && saved.document.version?.rootMakerId === this.store.getState().document.version.rootMakerId) {
        const restored = this.normalizeDocument(saved.document);
        this.store.replace(restored, saved.metadata?.recipe || restored.defaultRecipe, { clearHistory: true, markSaved: true });
      }
      if (playerSession?.session?.makerVersionId === this.runtimeDocument()?.version?.versionId) {
        this.playerRecipe = playerSession.session.recipe || this.playerRecipe;
        this.playerProfile = { ...this.playerProfile, ...(playerSession.session.profile || {}) };
        this.playerIntroOpen = false;
      }
      this.render();
    } catch (error) {
      this.store?.setSaveState('error', error.message || 'Could not restore the local Maker workspace.');
    }
  }

  ensureCreatorSelection(document) {
    let part = findPart(document, this.selectedPartId) || document.parts[0] || null;
    this.selectedPartId = part?.id || '';
    let item = part?.items.find((candidate) => candidate.id === this.selectedItemId) || part?.items[0] || null;
    this.selectedItemId = item?.id || '';
    let variant = item?.variants.find((candidate) => candidate.id === this.selectedVariantId) || item?.variants[0] || null;
    this.selectedVariantId = variant?.id || '';
    let binding = variant?.layerBindings.find((candidate) => candidate.id === this.selectedBindingId) || variant?.layerBindings[0] || null;
    this.selectedBindingId = binding?.id || '';
    this.selectedTrackId = document.layerTracks.some((track) => track.id === this.selectedTrackId)
      ? this.selectedTrackId
      : binding?.layerTrackId || document.layerTracks[0]?.id || '';
    this.selectedChannelId = document.colorChannels.some((channel) => channel.id === this.selectedChannelId)
      ? this.selectedChannelId
      : binding?.colorChannelId || document.colorChannels[0]?.id || '';
  }

  render() {
    if (!this.store) return this.renderEmpty();
    this.renderCreator();
    this.renderPlayer();
    requestAnimationFrame(() => {
      this.drawCreatorCanvas();
      this.drawPlayerCanvas();
      this.attachCanvasDrag();
    });
  }

  async save({ automatic = false } = {}) {
    if (!this.store || !this.makerKey || !this.context?.walletAddress) return;
    this.store.setSaveState('saving', automatic ? 'Autosaving changes…' : 'Saving changes…');
    try {
      const state = this.store.getState();
      await saveMakerWorkspaceDocument(this.makerKey, state.document, {
        recipe: state.recipe,
        journal: this.store.exportJournal(),
        makerVersionId: state.document.version.versionId,
        walletAddress: this.context.walletAddress,
      });
      this.store.setSaveState('saved', automatic ? 'Autosaved' : 'Saved');
      this.callbacks.onSaved?.({ document: state.document, recipe: state.recipe, assets: this.assets, automatic });
    } catch (error) {
      this.store.setSaveState('error', error.message || 'Local save failed.');
    }
  }

  async savePlayerSession() {
    if (!this.context?.walletAddress || !this.runtimeDocument()) return;
    try {
      await savePlayerWorkspaceSession(this.playerSessionKey, {
        makerVersionId: this.runtimeDocument().version.versionId,
        recipe: this.playerRecipe,
        profile: this.playerProfile,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.callbacks.onPlayerSaveError?.(error);
    }
  }

  selectedCreatorRecords(document = this.store?.getState().document) {
    const part = document ? findPart(document, this.selectedPartId) : null;
    const item = part ? findItem(document, part.id, this.selectedItemId) : null;
    const variant = item ? findVariant(document, part.id, item.id, this.selectedVariantId) : null;
    const binding = variant ? findBinding(document, part.id, item.id, variant.id, this.selectedBindingId) : null;
    return { part, item, variant, binding };
  }

  itemThumbnailUrl(item) {
    const explicit = this.runtimeAsset(item?.thumbnailAssetId);
    if (explicit?.thumbnailUrl || explicit?.url) return explicit.thumbnailUrl || explicit.url;
    const binding = item?.variants?.flatMap((variant) => variant.layerBindings || [])[0];
    const source = this.runtimeAsset(binding?.assetId);
    return source?.thumbnailUrl || source?.url || '';
  }

  publicationIssues(document = this.store?.getState().document) {
    if (!document) return [];
    const issues = collectMakerV4ValidationIssues(document, { mode: 'publish' })
      .filter((issue) => issue.path !== 'metadata.coverAssetId')
      .map(compactIssue);
    document.parts.forEach((part) => part.items.forEach((item) => item.variants.forEach((variant) => {
      variant.layerBindings.forEach((binding) => {
        const runtime = this.runtimeAsset(binding.assetId);
        if (!runtime && !document.assets.find((asset) => asset.id === binding.assetId)?.url) {
          issues.push({ code: 'runtime_asset_missing', path: `${part.id}/${item.id}/${variant.id}/${binding.id}`, message: `${part.name} / ${item.name} is missing its local or remote PNG.` });
        }
        if (binding.positionConfirmed === false) {
          issues.push({ code: 'position_unconfirmed', path: `${part.id}/${item.id}/${variant.id}/${binding.id}`, message: `${part.name} / ${item.name} has a cropped layer whose Canvas position is not confirmed.` });
        }
      });
    })));
    const runtime = this.runtimeDocument();
    try {
      const scene = resolveMakerScene(runtime, document.defaultRecipe, { strict: false });
      scene.issues.forEach((issue) => issues.push(compactIssue(issue)));
    } catch (error) {
      issues.push({ code: 'default_recipe_render', path: 'defaultRecipe', message: error.message });
    }
    const compatibility = this.compatibilityReport(document);
    if (compatibility && !compatibility.compatible && document.version.compatibility !== 'breaking') {
      issues.push({
        code: 'compatibility_declaration_mismatch',
        path: 'version.compatibility',
        message: 'This update changes existing recipes or rendering. Confirm it as breaking so old OCs remain pinned to their previous Maker version.',
      });
    }
    (document.extensions?.expansionDrafts || []).forEach((pack) => {
      const result = checkExpansionPackCompatibility(document, pack);
      result.errors.forEach((error) => issues.push({
        code: `expansion_${error.code || 'incompatible'}`,
        path: `extensions.expansionDrafts.${pack.packId || 'pack'}`,
        message: `${pack.name || pack.packId || 'ExpansionPack'}: ${error.message || error.code || 'not compatible with this Maker version'}.`,
      }));
    });
    return issues.filter((issue, index, entries) => entries.findIndex((candidate) => `${candidate.code}:${candidate.path}:${candidate.message}` === `${issue.code}:${issue.path}:${issue.message}`) === index);
  }

  compatibilityReport(document = this.store?.getState().document) {
    if (!document || !this.context?.publishedDocument) return null;
    try {
      return compareMakerCompatibility(this.context.publishedDocument, document);
    } catch (error) {
      return { compatible: false, level: 'error', summary: error.message, breaking: [{ code: 'compatibility-check', message: error.message }], warnings: [], additions: [] };
    }
  }

  getDocument() {
    return this.store ? clone(this.store.getState().document) : null;
  }

  getCreatorRecipe() {
    return this.store ? clone(this.store.getState().recipe) : null;
  }

  getPlayerSnapshot() {
    return {
      document: this.runtimeDocument() ? clone(this.runtimeDocument()) : null,
      recipe: clone(this.playerRecipe),
      profile: clone(this.playerProfile),
      assets: new Map(this.assets),
    };
  }

  getPublicationIssues() {
    return this.publicationIssues().map((issue) => ({ ...issue }));
  }

  beginNextVersion() {
    if (!this.store) return false;
    const before = this.store.getState().document.version.versionId;
    this.executeDocument('Start next Maker version', () => {});
    return this.store.getState().document.version.versionId !== before;
  }

  updateMakerSettings(settings = {}) {
    if (!this.store) return;
    const current = this.store.getState().document;
    const nextComparable = {
      name: settings.name ?? current.metadata.name,
      summary: settings.summary ?? current.metadata.summary,
      creator: settings.creator ?? current.metadata.creator,
      style: settings.style ?? current.metadata.style,
      licenseKind: settings.licenseKind ?? current.metadata.license.kind,
      licenseNote: settings.licenseNote ?? current.metadata.license.note,
      royaltyBps: settings.royaltyBps ?? current.publication.royaltyBps,
      mintingEnabled: settings.mintingEnabled ?? current.publication.mintingEnabled,
      mintFeeEnabled: settings.mintFeeEnabled ?? current.publication.mintFeeEnabled,
      mintPriceAtomic: settings.mintPriceAtomic ?? current.publication.mintPriceAtomic,
      paymentCoinType: settings.paymentCoinType ?? current.publication.paymentCoinType,
      paymentCoinSymbol: settings.paymentCoinSymbol ?? current.publication.paymentCoinSymbol,
    };
    const currentComparable = {
      name: current.metadata.name,
      summary: current.metadata.summary,
      creator: current.metadata.creator,
      style: current.metadata.style,
      licenseKind: current.metadata.license.kind,
      licenseNote: current.metadata.license.note,
      royaltyBps: current.publication.royaltyBps,
      mintingEnabled: current.publication.mintingEnabled,
      mintFeeEnabled: current.publication.mintFeeEnabled,
      mintPriceAtomic: current.publication.mintPriceAtomic,
      paymentCoinType: current.publication.paymentCoinType,
      paymentCoinSymbol: current.publication.paymentCoinSymbol,
    };
    if (JSON.stringify(nextComparable) === JSON.stringify(currentComparable)
      && settings.livingContent === undefined) return;
    this.executeDocument('Update Maker settings', ({ document }) => {
      Object.assign(document.metadata, {
        name: String(nextComparable.name),
        summary: String(nextComparable.summary),
        creator: String(nextComparable.creator),
        style: String(nextComparable.style),
      });
      document.metadata.license = {
        kind: String(nextComparable.licenseKind),
        note: String(nextComparable.licenseNote),
      };
      Object.assign(document.publication, {
        royaltyBps: Number(nextComparable.royaltyBps || 0),
        mintingEnabled: Boolean(nextComparable.mintingEnabled),
        mintFeeEnabled: Boolean(nextComparable.mintFeeEnabled),
        mintPriceAtomic: Number(nextComparable.mintPriceAtomic || 0),
        paymentCoinType: String(nextComparable.paymentCoinType || ''),
        paymentCoinSymbol: String(nextComparable.paymentCoinSymbol || ''),
      });
      if (settings.livingContent !== undefined) document.livingContent = clone(settings.livingContent);
    });
  }

  async renderRecipeToBlob(recipe = this.playerRecipe, { type = 'image/png', quality } = {}) {
    const document = this.runtimeDocument();
    if (!document) throw new Error('No Maker document is loaded.');
    const canvas = globalThis.document?.createElement?.('canvas');
    if (!canvas) throw new Error('Canvas export is only available in a browser.');
    const scene = resolveMakerScene(document, recipe, { strict: true });
    scene.layers.forEach((layer) => this.ensureAssetAlias(layer.assetId));
    await renderResolvedScene(scene, canvas, {
      skipMissingAssets: false,
      resolveAsset: (assetId) => this.assetResolver.resolve(assetId),
      applyColorChannel: this.applyColorChannel,
    });
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The shared Maker renderer could not export this recipe.'));
      }, type, quality);
    });
  }

  renderCreator() {
    if (!this.creatorRoot || !this.store) return;
    const state = this.store.getState();
    const document = state.document;
    this.ensureCreatorSelection(document);
    const { part, item, variant, binding } = this.selectedCreatorRecords(document);
    const issues = this.publicationIssues(document);
    const compatibility = this.compatibilityReport(document);
    const partRows = document.parts.map((candidate) => `
      <button class="v4-part-row ${candidate.id === part?.id ? 'active' : ''}" type="button" draggable="true" data-drag-kind="part" data-drag-id="${escapeHtml(candidate.id)}" data-action="select-part" data-part-id="${escapeHtml(candidate.id)}">
        <span class="v4-part-icon">${candidate.iconAssetId && this.runtimeAsset(candidate.iconAssetId)?.url ? `<img src="${escapeHtml(this.runtimeAsset(candidate.iconAssetId).url)}" alt="" />` : escapeHtml(candidate.name.slice(0, 2).toUpperCase())}</span>
        <span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(partStatus(candidate))}</small></span>
        <em>${candidate.required ? 'Required' : 'Optional'}</em>
      </button>
    `).join('');
    const itemRows = part?.items.map((candidate) => {
      const thumbnail = this.itemThumbnailUrl(candidate);
      return `
        <button class="v4-item-card ${candidate.id === item?.id ? 'active' : ''}" type="button" draggable="true" data-drag-kind="item" data-parent-id="${escapeHtml(part.id)}" data-drag-id="${escapeHtml(candidate.id)}" data-action="select-item" data-item-id="${escapeHtml(candidate.id)}">
          <span class="v4-item-thumb">${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" />` : '<i>PNG</i>'}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>${candidate.variants.length} style${candidate.variants.length === 1 ? '' : 's'}</small>
        </button>
      `;
    }).join('') || '<div class="v4-inline-empty"><strong>No Items yet</strong><span>Add an Item, then batch-import its PNG layers.</span></div>';
    const variantRows = item?.variants.map((candidate) => `
      <button class="v4-variant-chip ${candidate.id === variant?.id ? 'active' : ''}" type="button" draggable="true" data-drag-kind="variant" data-parent-id="${escapeHtml(`${part.id}/${item.id}`)}" data-drag-id="${escapeHtml(candidate.id)}" data-action="select-variant" data-variant-id="${escapeHtml(candidate.id)}">
        ${escapeHtml(candidate.name)} <span>${candidate.layerBindings.length}</span>
      </button>
    `).join('') || '';
    const bindingRows = variant?.layerBindings.map((candidate) => {
      const track = document.layerTracks.find((entry) => entry.id === candidate.layerTrackId);
      const runtime = this.runtimeAsset(candidate.assetId);
      return `
        <button class="v4-binding-row ${candidate.id === binding?.id ? 'active' : ''} ${this.hiddenBindingIds.has(candidate.id) ? 'muted' : ''}" type="button" data-action="select-binding" data-binding-id="${escapeHtml(candidate.id)}">
          <span>${runtime?.thumbnailUrl || runtime?.url ? `<img src="${escapeHtml(runtime.thumbnailUrl || runtime.url)}" alt="" />` : '◫'}</span>
          <strong>${escapeHtml(track?.name || candidate.layerTrackId)}</strong>
          <small>${escapeHtml(candidate.blendMode)} · ${Math.round(candidate.opacity * 100)}%</small>
        </button>
      `;
    }).join('') || '<div class="v4-inline-empty"><span>No visual LayerBinding in this style.</span></div>';

    this.creatorRoot.innerHTML = `
      <section class="v4-studio-shell">
        <header class="v4-studio-topbar">
          <div class="v4-studio-title">
            <span class="v4-eyebrow">Maker v4 Studio</span>
            <div><h2>${escapeHtml(document.metadata.name)}</h2><span class="v4-version-badge">${escapeHtml(document.version.versionId)} · ${document.canvas.width}×${document.canvas.height}</span></div>
          </div>
          <div class="v4-save-indicator ${escapeHtml(state.saveState)}"><i></i><span>${escapeHtml(state.saveMessage || (state.dirty ? 'Unsaved changes' : 'Saved'))}</span></div>
          <div class="v4-top-actions">
            <button type="button" data-action="undo" ${state.canUndo ? '' : 'disabled'} title="${escapeHtml(state.undoLabel)}">↶ Undo</button>
            <button type="button" data-action="redo" ${state.canRedo ? '' : 'disabled'} title="${escapeHtml(state.redoLabel)}">↷ Redo</button>
            <button type="button" data-action="save">Save</button>
            <button type="button" data-action="open-player">▶ Player test</button>
            <button class="primary" type="button" data-action="publish">Publish${issues.length ? ` · ${issues.length}` : ''}</button>
          </div>
        </header>

        <nav class="v4-studio-tabs" aria-label="Maker tools">
          ${[
            ['structure', 'Parts & Items'],
            ['layers', 'Layer Tracks'],
            ['colors', 'Smart Color'],
            ['rules', 'Rules'],
            ['expansions', 'Expansion Packs'],
            ['validate', `Preflight ${issues.length ? `(${issues.length})` : '✓'}`],
          ].map(([id, label]) => `<button type="button" class="${this.creatorTab === id ? 'active' : ''}" data-action="creator-tab" data-tab="${id}">${escapeHtml(label)}</button>`).join('')}
        </nav>

        <div class="v4-studio-workspace">
          <aside class="v4-parts-browser">
            <div class="v4-panel-head"><div><span>PARTS</span><strong>Player menu</strong></div><button type="button" data-action="add-part">＋</button></div>
            <div class="v4-parts-list">${partRows || '<div class="v4-inline-empty"><span>Create the first Part.</span></div>'}</div>
            ${part ? `<div class="v4-part-actions"><button type="button" data-action="copy-part">Duplicate</button><button type="button" data-action="delete-part" class="danger">Delete</button></div>` : ''}
          </aside>

          <main class="v4-canvas-column">
            <div class="v4-canvas-toolbar">
              <div><strong>True runtime preview</strong><span id="v4CreatorRenderStatus">Same renderer as Player, cover and final PNG</span></div>
              <div class="v4-canvas-tools">
                <button type="button" class="${this.creatorSolo ? 'active' : ''}" data-action="toggle-solo" ${binding ? '' : 'disabled'}>Solo</button>
                <button type="button" class="${this.creatorDimOthers ? 'active' : ''}" data-action="toggle-dim">Dim others</button>
                <label>Zoom <input type="range" min="50" max="200" step="10" value="${Math.round(this.creatorZoom * 100)}" data-action="canvas-zoom" /></label>
                <button type="button" class="${document.canvas.pixelMode === 'pixelated' ? 'active' : ''}" data-action="toggle-pixel">Pixel mode</button>
              </div>
            </div>
            <div class="v4-canvas-viewport ${document.canvas.pixelMode === 'pixelated' ? 'pixelated' : ''}">
              <div class="v4-canvas-ruler"><span>0,0</span><span>${document.canvas.width},${document.canvas.height}</span></div>
              <canvas id="makerV4CreatorCanvas" class="v4-runtime-canvas" style="width:${Math.round(this.creatorZoom * 100)}%" aria-label="Maker canvas"></canvas>
              ${!binding ? '<div class="v4-canvas-empty"><strong>Select a visual layer</strong><span>Choose an Item style and upload one or more PNGs.</span></div>' : ''}
            </div>
            <div class="v4-items-dock">
              <div class="v4-panel-head">
                <div><span>ITEMS</span><strong>${escapeHtml(part?.name || 'Select a Part')}</strong></div>
                <div>
                  <button type="button" data-action="add-item" ${part ? '' : 'disabled'}>＋ Item</button>
                  <label class="v4-file-button ${variant ? '' : 'disabled'}">Batch import<input type="file" accept="image/png" multiple data-action="batch-import" ${variant ? '' : 'disabled'} /></label>
                </div>
              </div>
              <div class="v4-item-grid">${itemRows}</div>
              ${item ? `<div class="v4-variant-row"><span>Styles</span>${variantRows}<button type="button" data-action="add-variant">＋ Style</button></div>` : ''}
            </div>
          </main>

          <aside class="v4-inspector">
            <div class="v4-panel-head"><div><span>INSPECTOR</span><strong>${escapeHtml(binding ? 'Layer' : item ? 'Item' : part ? 'Part' : 'Nothing selected')}</strong></div></div>
            ${this.renderCreatorInspector(document, part, item, variant, binding, bindingRows)}
          </aside>
        </div>

        <section class="v4-advanced-panel">${this.renderCreatorAdvanced(document, issues, compatibility)}</section>
      </section>
      ${this.renderImportDialog(document)}
    `;
  }

  renderCreatorInspector(document, part, item, variant, binding, bindingRows) {
    if (!part) return '<div class="v4-inline-empty"><strong>No Part selected</strong><span>Create a Part to begin.</span></div>';
    const parentOptions = ['<option value="">No parent</option>', ...document.parts.filter((candidate) => candidate.id !== part.id).map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${selected(part.parentPartId, candidate.id)}>${escapeHtml(candidate.name)}</option>`)].join('');
    const defaultOptions = part.items.map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${selected(part.defaultItemId, candidate.id)}>${escapeHtml(candidate.name)}</option>`).join('');
    const trackOptions = document.layerTracks.map((track) => `<option value="${escapeHtml(track.id)}" ${selected(binding?.layerTrackId, track.id)}>${escapeHtml(track.name)}</option>`).join('');
    const channelOptions = ['<option value="">No smart color</option>', ...document.colorChannels.map((channel) => `<option value="${escapeHtml(channel.id)}" ${selected(binding?.colorChannelId, channel.id)}>${escapeHtml(channel.name)}</option>`)].join('');
    const visibleOptions = ['<option value="">Always visible</option>', ...document.parts.filter((candidate) => candidate.id !== part.id).map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${selected(binding?.visibleWhen?.partId, candidate.id)}>${escapeHtml(`When ${candidate.name} selected`)}</option>`)].join('');
    return `
      <div class="v4-inspector-section">
        <span class="v4-inspector-label">Part</span>
        <label>Name<input value="${escapeHtml(part.name)}" data-action="part-name" maxlength="128" /></label>
        <div class="v4-toggle-grid">
          <label><input type="checkbox" ${checked(part.required)} data-action="part-required" /> Required</label>
          <label><input type="checkbox" ${checked(part.menuVisible)} data-action="part-visible" /> Player menu</label>
        </div>
        <label>Parent Part<select data-action="part-parent">${parentOptions}</select></label>
        <label>Default Item<select data-action="part-default" ${part.items.length ? '' : 'disabled'}><option value="">None</option>${defaultOptions}</select></label>
        <label class="v4-file-button wide">Upload Part icon<input type="file" accept="image/png,image/jpeg" data-action="part-icon" /></label>
      </div>
      ${item ? `
        <div class="v4-inspector-section">
          <span class="v4-inspector-label">Item</span>
          <label>Name<input value="${escapeHtml(item.name)}" data-action="item-name" maxlength="128" /></label>
          <div class="v4-inline-actions"><button type="button" data-action="copy-item">Duplicate</button><button type="button" class="danger" data-action="delete-item">Delete</button></div>
          <label class="v4-file-button wide">Custom thumbnail<input type="file" accept="image/png,image/jpeg" data-action="item-thumbnail" /></label>
        </div>
        <div class="v4-inspector-section">
          <span class="v4-inspector-label">Style</span>
          <label>Name<input value="${escapeHtml(variant?.name || '')}" data-action="variant-name" maxlength="128" ${variant ? '' : 'disabled'} /></label>
          <div class="v4-inline-actions"><button type="button" data-action="copy-variant" ${variant ? '' : 'disabled'}>Duplicate</button><button type="button" class="danger" data-action="delete-variant" ${item.variants.length > 1 ? '' : 'disabled'}>Delete</button></div>
          <div class="v4-binding-list">${bindingRows}</div>
          <button type="button" data-action="add-empty-binding" ${document.layerTracks.length ? '' : 'disabled'}>＋ Empty LayerBinding</button>
        </div>
      ` : ''}
      ${binding ? `
        <div class="v4-inspector-section prominent">
          <div class="v4-inspector-section-head"><span class="v4-inspector-label">Selected layer</span><button type="button" class="danger" data-action="delete-binding">Delete</button></div>
          <label>Layer Track<select data-action="binding-track">${trackOptions}</select></label>
          <label class="v4-file-button wide">Replace layer PNG<input type="file" accept="image/png" data-action="binding-asset" /></label>
          <div class="v4-number-grid">
            <label>X<input type="number" value="${Number(binding.transform.x).toFixed(1)}" data-action="binding-x" /></label>
            <label>Y<input type="number" value="${Number(binding.transform.y).toFixed(1)}" data-action="binding-y" /></label>
            <label>Scale<input type="number" min="0.01" max="100" step="0.01" value="${Number(binding.transform.scale).toFixed(2)}" data-action="binding-scale" /></label>
            <label>Rotate<input type="number" step="1" value="${Number(binding.transform.rotation).toFixed(1)}" data-action="binding-rotation" /></label>
          </div>
          <label>Scale on Canvas<input type="range" min="5" max="400" value="${Math.round(Number(binding.transform.scale) * 100)}" data-action="binding-scale-preview" /></label>
          <label>Opacity<input type="range" min="0" max="100" value="${Math.round(binding.opacity * 100)}" data-action="binding-opacity" /></label>
          <label>Blend mode<select data-action="binding-blend">${['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity','linear-dodge'].map((mode) => `<option value="${mode}" ${selected(binding.blendMode, mode)}>${mode}</option>`).join('')}</select></label>
          <label>Smart color<select data-action="binding-channel">${channelOptions}</select></label>
          <label>Show this layer<select data-action="binding-visible-when">${visibleOptions}</select></label>
          <div class="v4-inline-actions"><button type="button" data-action="toggle-binding-hidden">${this.hiddenBindingIds.has(binding.id) ? 'Show layer' : 'Hide layer'}</button><button type="button" class="primary" data-action="confirm-position">${binding.positionConfirmed === false ? 'Confirm position' : 'Position confirmed ✓'}</button></div>
          <small>Drag directly on the Canvas to position this layer. Player movement remains disabled.</small>
        </div>
      ` : ''}
    `;
  }

  renderCreatorAdvanced(document, issues, compatibility) {
    if (this.creatorTab === 'structure') {
      const { part, item, variant } = this.selectedCreatorRecords(document);
      return `
        <div class="v4-advanced-head"><div><span>MAKER STRUCTURE</span><h3>One click can own many visual layers</h3></div><button type="button" data-action="set-default-recipe">Set current combination as default</button></div>
        <div class="v4-explainer-grid">
          <article><strong>Part</strong><span>Player menu category</span><em>${escapeHtml(part?.name || '—')}</em></article>
          <article><strong>Item</strong><span>One player click</span><em>${escapeHtml(item?.name || '—')}</em></article>
          <article><strong>Style</strong><span>Explicit secondary variant</span><em>${escapeHtml(variant?.name || '—')}</em></article>
          <article><strong>LayerBinding</strong><span>One PNG on one global track</span><em>${variant?.layerBindings.length || 0} active layers</em></article>
        </div>
      `;
    }
    if (this.creatorTab === 'layers') {
      const rows = document.layerTracks.map((track) => {
        const bindings = document.parts.flatMap((part) => part.items.flatMap((item) => item.variants.flatMap((variant) => variant.layerBindings.filter((binding) => binding.layerTrackId === track.id))));
        return `
          <div class="v4-track-row ${track.id === this.selectedTrackId ? 'active' : ''}" draggable="true" data-drag-kind="track" data-drag-id="${escapeHtml(track.id)}" data-drop-kind="track">
            <button type="button" data-action="select-track" data-track-id="${escapeHtml(track.id)}"><span>⋮⋮</span><strong>${escapeHtml(track.name)}</strong><small>${bindings.length} binding${bindings.length === 1 ? '' : 's'}</small></button>
            <input value="${escapeHtml(track.name)}" data-action="track-name" data-track-id="${escapeHtml(track.id)}" maxlength="128" />
            <div><button type="button" data-action="move-track" data-track-id="${escapeHtml(track.id)}" data-direction="up">↑</button><button type="button" data-action="move-track" data-track-id="${escapeHtml(track.id)}" data-direction="down">↓</button><button type="button" data-action="delete-track" data-track-id="${escapeHtml(track.id)}" ${bindings.length ? 'disabled' : ''}>×</button></div>
          </div>
        `;
      }).join('');
      return `
        <div class="v4-advanced-head"><div><span>LAYER TRACKS</span><h3>Global render order · back → front</h3><p>Player menu order never controls visual z-order.</p></div><button type="button" data-action="add-track">＋ Layer Track</button></div>
        <div class="v4-track-list">${rows || '<div class="v4-inline-empty"><span>Add a Layer Track before importing artwork.</span></div>'}</div>
      `;
    }
    if (this.creatorTab === 'colors') {
      const selectedChannel = document.colorChannels.find((channel) => channel.id === this.selectedChannelId) || document.colorChannels[0];
      const channels = document.colorChannels.map((channel) => `
        <button type="button" class="v4-color-channel-card ${selectedChannel?.id === channel.id ? 'active' : ''}" data-action="select-channel" data-channel-id="${escapeHtml(channel.id)}">
          <span style="--swatch:${escapeHtml(channel.swatches.find((swatch) => swatch.id === channel.defaultSwatchId)?.hintColor || '#7b5cff')}"></span>
          <strong>${escapeHtml(channel.name)}</strong><small>${channel.swatches.length} colors · ${escapeHtml(channel.mode)}</small>
        </button>
      `).join('');
      const swatches = selectedChannel?.swatches.map((swatch) => `
        <div class="v4-swatch-editor ${swatch.id === selectedChannel.defaultSwatchId ? 'default' : ''}">
          <input type="radio" name="v4-default-swatch" value="${escapeHtml(swatch.id)}" ${checked(swatch.id === selectedChannel.defaultSwatchId)} data-action="channel-default-swatch" title="Default color" />
          <input value="${escapeHtml(swatch.name)}" data-action="swatch-name" data-swatch-id="${escapeHtml(swatch.id)}" maxlength="128" />
          <label>Hint<input type="color" value="${escapeHtml(swatch.hintColor)}" data-action="swatch-hint" data-swatch-id="${escapeHtml(swatch.id)}" /></label>
          ${selectedChannel.mode === 'gradient-map' ? `
            <label>Shadow<input type="color" value="${escapeHtml(swatch.stops[0]?.color || '#111111')}" data-action="swatch-stop" data-swatch-id="${escapeHtml(swatch.id)}" data-stop-index="0" /></label>
            <label>Mid<input type="color" value="${escapeHtml(swatch.stops[Math.floor((swatch.stops.length - 1) / 2)]?.color || swatch.hintColor)}" data-action="swatch-mid" data-swatch-id="${escapeHtml(swatch.id)}" /></label>
            <label>Light<input type="color" value="${escapeHtml(swatch.stops.at(-1)?.color || '#ffffff')}" data-action="swatch-stop" data-swatch-id="${escapeHtml(swatch.id)}" data-stop-index="${Math.max(1, swatch.stops.length - 1)}" /></label>
          ` : '<span>Upload one asset per swatch on each binding.</span>'}
          <button type="button" data-action="delete-swatch" data-swatch-id="${escapeHtml(swatch.id)}" ${selectedChannel.swatches.length <= 1 ? 'disabled' : ''}>×</button>
        </div>
      `).join('') || '';
      const linkedBindings = selectedChannel ? document.parts.flatMap((part) => part.items.flatMap((item) => item.variants.flatMap((variant) => variant.layerBindings.filter((binding) => binding.colorChannelId === selectedChannel.id).map((binding) => `${part.name} / ${item.name} / ${variant.name}`)))) : [];
      return `
        <div class="v4-advanced-head"><div><span>SMART COLOR</span><h3>Shared deterministic color channels</h3><p>Gradient-map preserves source luminance; linked layers switch together.</p></div><button type="button" data-action="add-channel">＋ Color Channel</button></div>
        <div class="v4-color-workspace">
          <div class="v4-color-channel-list">${channels || '<div class="v4-inline-empty"><span>Create a channel, then bind layers from the Inspector.</span></div>'}</div>
          ${selectedChannel ? `<div class="v4-color-detail">
            <div class="v4-form-row"><label>Name<input value="${escapeHtml(selectedChannel.name)}" data-action="channel-name" /></label><label>Mode<select data-action="channel-mode"><option value="gradient-map" ${selected(selectedChannel.mode, 'gradient-map')}>Gradient map</option><option value="asset-map" ${selected(selectedChannel.mode, 'asset-map')}>Separate assets</option></select></label><button type="button" class="danger" data-action="delete-channel">Delete</button></div>
            <div class="v4-swatch-list">${swatches}</div>
            <button type="button" data-action="add-swatch">＋ Color preset</button>
            <p class="v4-linked-copy"><strong>Linked layers:</strong> ${linkedBindings.length ? linkedBindings.map(escapeHtml).join(' · ') : 'None yet'}</p>
          </div>` : ''}
        </div>
      `;
    }
    if (this.creatorTab === 'rules') {
      const rows = ownerRuleRows(document);
      const partOptions = document.parts.map((part) => `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)}</option>`).join('');
      const targetOptions = document.parts.flatMap((part) => [
        `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)} / any Item</option>`,
        ...part.items.flatMap((item) => [
          `<option value="${escapeHtml(`${part.id}::${item.id}`)}">${escapeHtml(part.name)} / ${escapeHtml(item.name)}</option>`,
          ...item.variants.map((variant) => `<option value="${escapeHtml(`${part.id}::${item.id}::${variant.id}`)}">${escapeHtml(part.name)} / ${escapeHtml(item.name)} / ${escapeHtml(variant.name)}</option>`),
        ]),
      ]).join('');
      return `
        <div class="v4-advanced-head"><div><span>REQUIRES / EXCLUDES</span><h3>Only valid OC combinations reach the player</h3><p>Hierarchy controls whole child Parts; rules control specific selections.</p></div></div>
        <div class="v4-rule-builder">
          <label>When Part<select id="v4RuleOwnerPart" data-action="rule-owner-part">${partOptions}</select></label>
          <label>Owner scope<select id="v4RuleOwnerScope"><option value="part">Whole Part</option><option value="item">Selected Item</option><option value="variant">Selected Style</option></select></label>
          <label>Rule<select id="v4RuleType"><option value="excludes">cannot combine with</option><option value="requires">requires</option></select></label>
          <label>Target definition<select id="v4RuleTargetDefinition">${targetOptions}</select></label>
          <button type="button" data-action="add-rule">Add rule</button>
        </div>
        <div class="v4-rule-list">${rows.map((row) => {
          const targetPart = findPart(document, row.target.partId);
          const targetItem = row.target.itemId ? findItem(document, row.target.partId, row.target.itemId) : null;
          const targetVariant = row.target.variantId && targetItem ? targetItem.variants.find((variant) => variant.id === row.target.variantId) : null;
          return `<div><span>${escapeHtml(row.ownerName)}</span><b>${row.type === 'requires' ? 'requires' : 'cannot combine with'}</b><span>${escapeHtml(targetPart?.name || row.target.partId)}${targetItem ? ` / ${escapeHtml(targetItem.name)}` : ''}${targetVariant ? ` / ${escapeHtml(targetVariant.name)}` : ''}</span><button type="button" data-action="delete-rule" data-rule-id="${escapeHtml(row.id)}">×</button></div>`;
        }).join('') || '<div class="v4-inline-empty"><span>No constraints. Random may use every visible Item.</span></div>'}</div>
      `;
    }
    if (this.creatorTab === 'expansions') {
      const drafts = document.extensions.expansionDrafts || [];
      const cards = drafts.map((pack) => {
        const result = checkExpansionPackCompatibility(document, pack);
        const enabled = this.enabledExpansionIds.has(pack.packId);
        return `
          <article class="v4-expansion-card ${result.compatible ? 'ready' : 'error'}">
            <header><div><span>${escapeHtml(pack.namespace)}</span><h4>${escapeHtml(pack.name)}</h4></div><em>${escapeHtml(pack.version)}</em></header>
            <p>${pack.parts.length} Part extension${pack.parts.length === 1 ? '' : 's'} · ${pack.assets.length} assets</p>
            <small>${result.compatible ? 'Compatible additive overlay' : result.errors.map((error) => error.code).join(', ')}</small>
            <div><button type="button" data-action="toggle-expansion" data-pack-id="${escapeHtml(pack.packId)}" ${result.compatible ? '' : 'disabled'}>${enabled ? 'Disable preview' : 'Enable preview'}</button><button type="button" data-action="add-selected-to-expansion" data-pack-id="${escapeHtml(pack.packId)}" ${this.selectedItemId ? '' : 'disabled'}>Add selected Item copy</button><button type="button" data-action="delete-expansion" data-pack-id="${escapeHtml(pack.packId)}" class="danger">Delete</button></div>
          </article>
        `;
      }).join('');
      return `
        <div class="v4-advanced-head"><div><span>EXPANSION PACKS</span><h3>Additive DLC without mutating the base Maker</h3><p>Every Pack is namespaced and pinned to this Maker version.</p></div><button type="button" data-action="add-expansion">＋ Expansion Pack</button></div>
        <div class="v4-expansion-grid">${cards || '<div class="v4-inline-empty"><strong>No Expansion Packs</strong><span>Create one, then copy selected Items into its isolated namespace.</span></div>'}</div>
      `;
    }
    const issueRows = issues.map((issue) => `<li class="${issue.code.includes('missing') || issue.code.includes('invalid') ? 'error' : 'warning'}"><span>${escapeHtml(issue.path || 'Maker')}</span><strong>${escapeHtml(issue.message)}</strong></li>`).join('');
    return `
      <div class="v4-advanced-head"><div><span>PUBLISH PREFLIGHT</span><h3>${issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'} block publication` : 'Ready to publish'}</h3><p>Creator, Player, cover and final export all resolve this same document.</p></div><button type="button" data-action="run-preflight">Run again</button></div>
      ${compatibility ? `<div class="v4-compatibility ${compatibility.compatible ? 'ready' : 'breaking'}"><div><strong>${compatibility.compatible ? 'Compatible Maker update' : 'Breaking update — old OCs stay pinned'}</strong><span>${escapeHtml(compatibility.summary)}</span></div>${!compatibility.compatible && document.version.compatibility !== 'breaking' ? '<button type="button" data-action="set-version-compatibility" data-compatibility="breaking">Confirm breaking update</button>' : compatibility.compatible && document.version.compatibility === 'breaking' ? '<button type="button" data-action="set-version-compatibility" data-compatibility="compatible">Use compatible update</button>' : '<em>Compatibility confirmed</em>'}</div>` : '<div class="v4-compatibility ready"><strong>Initial Maker version</strong><span>No published version is being replaced.</span></div>'}
      <ul class="v4-preflight-list">${issueRows || '<li class="ready"><span>All checks</span><strong>Default recipe and runtime structure are valid.</strong></li>'}</ul>
    `;
  }

  renderImportDialog(document) {
    if (!this.pendingImport) return '';
    const options = ['<option value="">Create a new Layer Track</option>', ...document.layerTracks.map((track) => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.name)}</option>`)].join('');
    return `
      <div class="v4-modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm batch import mapping">
        <section class="v4-import-dialog">
          <header><div><span>BATCH IMPORT</span><h3>Confirm PNG → Layer Track mapping</h3></div><button type="button" data-action="cancel-import">×</button></header>
          <p>Files are not committed until you confirm. Full-canvas PNGs land at 0,0; cropped PNGs must be positioned and confirmed.</p>
          <div class="v4-import-list">${this.pendingImport.mapping.map((mapping, index) => `
            <div><span>${escapeHtml(mapping.fileName)}</span><em>${escapeHtml(mapping.confidence)}</em><select data-action="import-track" data-import-index="${index}">${options.replace(`value="${escapeHtml(mapping.trackId)}"`, `value="${escapeHtml(mapping.trackId)}" selected`)}</select><input data-action="import-track-name" data-import-index="${index}" value="${escapeHtml(mapping.suggestedTrackName)}" aria-label="New track name" /></div>
          `).join('')}</div>
          <footer><button type="button" data-action="cancel-import">Cancel</button><button class="primary" type="button" data-action="confirm-import">Import ${this.pendingImport.mapping.length} PNG${this.pendingImport.mapping.length === 1 ? '' : 's'}</button></footer>
        </section>
      </div>
    `;
  }

  activePlayerParts(document, recipe = this.playerRecipe) {
    const selections = recipeSelectionMap(recipe);
    const visibilityContext = {
      selections: recipe.selections || [],
      colorChannels: Object.fromEntries((recipe.colors || []).map((entry) => [entry.channelId, entry.swatchId])),
    };
    return document.parts.filter((part) => {
      if (!part.menuVisible) return false;
      if (part.parentPartId && !selections.get(part.parentPartId)?.itemId) return false;
      if (!evaluateVisibleWhen(part.visibleWhen, visibilityContext)) return false;
      return true;
    });
  }

  renderPlayer() {
    if (!this.playerRoot || !this.store) return;
    const document = this.runtimeDocument();
    if (!document) return;
    const recipe = recipeWithColors(document, this.playerRecipe);
    const parts = this.activePlayerParts(document, recipe);
    let part = parts.find((candidate) => candidate.id === this.playerPartId) || parts[0] || null;
    this.playerPartId = part?.id || '';
    const selectionMap = recipeSelectionMap(recipe);
    const visibilityContext = {
      selections: recipe.selections || [],
      colorChannels: Object.fromEntries((recipe.colors || []).map((entry) => [entry.channelId, entry.swatchId])),
    };
    const visibleItems = part?.items.filter((item) => evaluateVisibleWhen(item.visibleWhen, visibilityContext)) || [];
    const currentSelection = part ? selectionMap.get(part.id) : null;
    const currentItem = visibleItems.find((item) => item.id === currentSelection?.itemId) || null;
    const visibleVariants = currentItem?.variants.filter((variant) => evaluateVisibleWhen(variant.visibleWhen, visibilityContext)) || [];
    const currentVariant = visibleVariants.find((variant) => variant.id === currentSelection?.variantId)
      || visibleVariants.find((variant) => variant.id === currentItem?.defaultVariantId)
      || visibleVariants[0]
      || null;
    const recipeResult = evaluateRecipe(document, recipe);
    const partButtons = parts.map((candidate) => {
      const selection = selectionMap.get(candidate.id);
      return `
        <button type="button" class="v4-player-part ${candidate.id === part?.id ? 'active' : ''}" data-action="player-part" data-part-id="${escapeHtml(candidate.id)}">
          <span>${candidate.iconAssetId && this.runtimeAsset(candidate.iconAssetId)?.url ? `<img src="${escapeHtml(this.runtimeAsset(candidate.iconAssetId).url)}" alt="" />` : escapeHtml(candidate.name.slice(0, 2).toUpperCase())}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>${selection?.itemId ? 'Selected' : candidate.required ? 'Required' : 'None'}</small>
        </button>
      `;
    }).join('');
    const itemButtons = visibleItems.map((candidate) => {
      const thumbnail = this.itemThumbnailUrl(candidate);
      return `
        <button type="button" class="v4-player-item ${candidate.id === currentItem?.id ? 'active' : ''}" data-action="player-item" data-item-id="${escapeHtml(candidate.id)}">
          <span>${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" />` : '<i>PNG</i>'}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          ${candidate.variants.length > 1 ? `<em>${candidate.variants.length} styles</em>` : ''}
        </button>
      `;
    }).join('') || '';
    const variantButtons = visibleVariants.map((candidate) => `
      <button type="button" class="${candidate.id === currentVariant?.id ? 'active' : ''}" data-action="player-variant" data-variant-id="${escapeHtml(candidate.id)}">${escapeHtml(candidate.name)}</button>
    `).join('') || '';
    const usedChannelIds = new Set(currentVariant?.layerBindings.map((binding) => binding.colorChannelId).filter(Boolean) || []);
    const colorRows = document.colorChannels.filter((channel) => usedChannelIds.has(channel.id)).map((channel) => {
      const selectedColor = recipe.colors?.find((entry) => entry.channelId === channel.id)?.swatchId || channel.defaultSwatchId;
      return `
        <div class="v4-player-colors"><span>${escapeHtml(channel.name)}</span><div>${channel.swatches.map((swatch) => `<button type="button" class="${swatch.id === selectedColor ? 'active' : ''}" style="--swatch:${escapeHtml(swatch.hintColor)}" data-action="player-color" data-channel-id="${escapeHtml(channel.id)}" data-swatch-id="${escapeHtml(swatch.id)}" title="${escapeHtml(swatch.name)}"><i></i></button>`).join('')}</div></div>
      `;
    }).join('');
    const packs = this.store.getState().document.extensions?.expansionDrafts || [];
    const selectedSummary = parts.map((candidate) => {
      const selectedItem = candidate.items.find((item) => item.id === selectionMap.get(candidate.id)?.itemId);
      return selectedItem ? `<span>${escapeHtml(candidate.name)}: ${escapeHtml(selectedItem.name)}</span>` : '';
    }).join('');

    this.playerRoot.innerHTML = `
      <section class="v4-player-shell">
        <header class="v4-player-header">
          <div><span class="v4-eyebrow">Character Maker</span><h1>${escapeHtml(document.metadata.name)}</h1><p>by ${escapeHtml(document.metadata.creator || 'Unknown creator')} · ${escapeHtml(document.version.versionId)}</p></div>
          <div class="v4-player-tools">
            <button type="button" data-action="player-info">ⓘ Info & license</button>
            <button type="button" data-action="player-undo" ${this.playerUndo.length ? '' : 'disabled'}>↶</button>
            <button type="button" data-action="player-redo" ${this.playerRedo.length ? '' : 'disabled'}>↷</button>
            <button type="button" data-action="player-random">Random</button>
            <button type="button" data-action="player-clear">Remove optional</button>
            <button type="button" data-action="player-reset">Reset</button>
          </div>
        </header>
        <div class="v4-player-main">
          <section class="v4-player-preview">
            <div class="v4-player-canvas-wrap ${document.canvas.pixelMode === 'pixelated' ? 'pixelated' : ''}">
              <canvas id="makerV4PlayerCanvas" class="v4-runtime-canvas" aria-label="Your OC preview"></canvas>
              <div id="v4PlayerRenderStatus" class="v4-render-status">Loading default recipe…</div>
            </div>
            <div class="v4-player-nameplate"><div><strong>${escapeHtml(this.playerProfile.name || 'Untitled OC')}</strong><span>${escapeHtml(this.playerProfile.world || document.metadata.style || 'Original Character')}</span></div><em>${recipeResult.valid ? 'Valid combination' : `${recipeResult.violations.length} rule issue${recipeResult.violations.length === 1 ? '' : 's'}`}</em></div>
            <div class="v4-player-recipe-strip">${selectedSummary}</div>
          </section>
          <section class="v4-player-controls">
            <div class="v4-player-part-rail">${partButtons}</div>
            <div class="v4-player-picker">
              <header><div><span>CURRENT PART</span><h2>${escapeHtml(part?.name || 'No playable Parts')}</h2></div>${part && !part.required ? `<button type="button" data-action="player-none" class="secondary">None / Remove</button>` : ''}</header>
              <div class="v4-player-item-grid">${itemButtons || '<div class="v4-inline-empty"><span>This Part has no available Items.</span></div>'}</div>
              ${currentItem && visibleVariants.length > 1 ? `<div class="v4-player-variant-picker"><span>Style</span>${variantButtons}</div>` : ''}
              ${colorRows || ''}
              ${packs.length ? `<details class="v4-player-expansions"><summary>Expansion Packs</summary>${packs.map((pack) => {
                const compatibility = checkExpansionPackCompatibility(this.store.getState().document, pack);
                return `<label><input type="checkbox" data-action="player-expansion" value="${escapeHtml(pack.packId)}" ${checked(this.enabledExpansionIds.has(pack.packId))} ${compatibility.compatible ? '' : 'disabled'} /><span><strong>${escapeHtml(pack.name)}</strong><small>${compatibility.compatible ? 'Optional content pack' : 'Not compatible with this version'}</small></span></label>`;
              }).join('')}</details>` : ''}
            </div>
          </section>
        </div>
        <footer class="v4-player-finishbar">
          <div class="v4-player-profile-fields">
            <label>OC name<input value="${escapeHtml(this.playerProfile.name)}" data-action="player-profile-name" maxlength="128" /></label>
            <label>World<input value="${escapeHtml(this.playerProfile.world)}" data-action="player-profile-world" maxlength="128" /></label>
          </div>
          <div><span>${recipeResult.valid ? 'Draft autosaved to this wallet workspace' : 'Fix the current rule conflict before finishing'}</span><button type="button" data-action="player-export">Recipe JSON</button><button class="primary" type="button" data-action="player-complete" ${recipeResult.valid ? '' : 'disabled'}>Complete OC</button></div>
        </footer>
      </section>
      ${this.playerIntroOpen ? `
        <div class="v4-modal-backdrop player-info" role="dialog" aria-modal="true">
          <section class="v4-player-info-dialog">
            <span class="v4-eyebrow">Before you make</span>
            <h2>${escapeHtml(document.metadata.name)}</h2>
            <p>${escapeHtml(document.metadata.summary || 'Combine the creator-provided Parts to make your OC.')}</p>
            <dl><div><dt>Creator</dt><dd>${escapeHtml(document.metadata.creator || 'Unknown')}</dd></div><div><dt>License</dt><dd>${escapeHtml(document.metadata.license?.kind || 'personal-use')}</dd></div><div><dt>Version</dt><dd>${escapeHtml(document.version.versionId)}</dd></div></dl>
            <blockquote>${escapeHtml(document.metadata.license?.note || 'Follow the creator policy shown with this Maker.')}</blockquote>
            <button type="button" class="primary" data-action="close-player-info">Start making</button>
          </section>
        </div>
      ` : ''}
    `;
  }

  documentWithCreatorPreview() {
    const base = clone(this.runtimeDocument());
    if (!this.dragPreview && this.bindingScalePreview == null) return base;
    const binding = findBinding(base, this.selectedPartId, this.selectedItemId, this.selectedVariantId, this.selectedBindingId);
    if (!binding) return base;
    if (this.dragPreview) {
      binding.transform.x = this.dragPreview.x;
      binding.transform.y = this.dragPreview.y;
    }
    if (this.bindingScalePreview != null) binding.transform.scale = this.bindingScalePreview;
    return base;
  }

  ensureAssetAlias(assetId) {
    if (this.assets.has(assetId)) return;
    const record = this.runtimeAsset(assetId);
    if (record) this.assets.set(assetId, record);
  }

  async drawCreatorCanvas() {
    const canvas = this.creatorRoot?.querySelector('#makerV4CreatorCanvas');
    if (!canvas || !this.store) return;
    this.renderAbort.creator?.abort();
    const controller = new AbortController();
    this.renderAbort.creator = controller;
    const status = this.creatorRoot.querySelector('#v4CreatorRenderStatus');
    try {
      const document = this.documentWithCreatorPreview();
      const recipe = this.store.getState().recipe;
      const scene = resolveMakerScene(document, recipe, { strict: false });
      scene.layers = scene.layers.filter((layer) => !this.hiddenBindingIds.has(layer.bindingId));
      if (this.creatorSolo && this.selectedBindingId) scene.layers = scene.layers.filter((layer) => layer.bindingId === this.selectedBindingId);
      else if (this.creatorDimOthers && this.selectedBindingId) scene.layers.forEach((layer) => {
        if (layer.bindingId !== this.selectedBindingId) layer.opacity *= 0.22;
      });
      scene.layers.forEach((layer) => this.ensureAssetAlias(layer.assetId));
      const result = await renderResolvedScene(scene, canvas, {
        signal: controller.signal,
        skipMissingAssets: true,
        resolveAsset: (assetId) => this.assetResolver.resolve(assetId),
        applyColorChannel: this.applyColorChannel,
      });
      if (controller.signal.aborted) return;
      if (status) status.textContent = result.skipped.length
        ? `${result.drawn} layers · ${result.skipped.length} asset${result.skipped.length === 1 ? '' : 's'} unavailable`
        : `${result.drawn} layers · shared runtime renderer`;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (status) status.textContent = error.message || 'Canvas render failed.';
    }
  }

  async drawPlayerCanvas() {
    const canvas = this.playerRoot?.querySelector('#makerV4PlayerCanvas');
    if (!canvas || !this.store) return;
    this.renderAbort.player?.abort();
    const controller = new AbortController();
    this.renderAbort.player = controller;
    const status = this.playerRoot.querySelector('#v4PlayerRenderStatus');
    try {
      const document = this.runtimeDocument();
      const scene = resolveMakerScene(document, this.playerRecipe, { strict: false });
      scene.layers.forEach((layer) => this.ensureAssetAlias(layer.assetId));
      const result = await renderResolvedScene(scene, canvas, {
        signal: controller.signal,
        skipMissingAssets: true,
        resolveAsset: (assetId) => this.assetResolver.resolve(assetId),
        applyColorChannel: this.applyColorChannel,
      });
      if (controller.signal.aborted) return;
      if (status) {
        status.textContent = result.skipped.length
          ? `Keeping the valid frame while ${result.skipped.length} asset${result.skipped.length === 1 ? '' : 's'} retry.`
          : `${result.drawn} layers ready`;
        status.classList.toggle('ready', !result.skipped.length);
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (status) status.textContent = error.message || 'Preview render failed.';
    }
  }

  attachCanvasDrag() {
    const canvas = this.creatorRoot?.querySelector('#makerV4CreatorCanvas');
    if (!canvas || canvas.dataset.dragReady === 'true') return;
    canvas.dataset.dragReady = 'true';
    canvas.addEventListener('pointerdown', (event) => {
      const { binding } = this.selectedCreatorRecords();
      if (!binding || event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const start = {
        clientX: event.clientX,
        clientY: event.clientY,
        x: Number(binding.transform.x || 0),
        y: Number(binding.transform.y || 0),
        ratioX: this.store.getState().document.canvas.width / Math.max(1, rect.width),
        ratioY: this.store.getState().document.canvas.height / Math.max(1, rect.height),
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
      const move = (moveEvent) => {
        this.dragPreview = {
          x: Math.round((start.x + ((moveEvent.clientX - start.clientX) * start.ratioX)) * 10) / 10,
          y: Math.round((start.y + ((moveEvent.clientY - start.clientY) * start.ratioY)) * 10) / 10,
        };
        this.drawCreatorCanvas();
      };
      const finish = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', finish);
        canvas.removeEventListener('pointercancel', finish);
        canvas.classList.remove('dragging');
        const preview = this.dragPreview;
        this.dragPreview = null;
        if (!preview || (preview.x === start.x && preview.y === start.y)) return;
        this.executeDocument('Move layer on Canvas', ({ document }) => {
          const target = findBinding(document, this.selectedPartId, this.selectedItemId, this.selectedVariantId, this.selectedBindingId);
          if (!target) return;
          target.transform.x = preview.x;
          target.transform.y = preview.y;
          target.positionConfirmed = true;
        });
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);
    });
  }

  executeDocument(label, mutator) {
    if (!this.store) return;
    const before = new Set(this.store.getState().document.assets.map((asset) => asset.id));
    this.store.execute(label, (next) => {
      const published = this.context?.publishedDocument;
      if (this.context?.isPublished
        && isMakerV4Document(published)
        && next.document.version.versionId === published.version.versionId) {
        const number = Math.max(Number(next.document.version.number || 1), Number(published.version.number || 1)) + 1;
        next.document.version = {
          ...next.document.version,
          versionId: `${next.document.version.rootMakerId}-v${number}`,
          number,
          parentVersionId: published.version.versionId,
          compatibility: 'compatible',
          compatibleFrom: Number(published.version.compatibleFrom || 1),
          createdAt: null,
          changelog: '',
        };
        next.document.extensions ||= {};
        next.document.extensions.updateFromVersionId = published.version.versionId;
      }
      mutator(next);
      normalizeDocumentOrders(next.document);
      synchronizeDefaultRecipe(next.document);
      next.recipe = recipeWithColors(next.document, next.recipe);
    });
    const after = new Set(this.store.getState().document.assets.map((asset) => asset.id));
    const removed = [...before].filter((assetId) => !after.has(assetId));
    if (removed.length) {
      removed.forEach((assetId) => {
        const record = this.assets.get(assetId);
        if (record) revokeRuntimeAsset(record);
        this.assets.delete(assetId);
      });
      this.assetResolver.clear();
      this.assetResolver = createCachedAssetResolver(this.assets);
      deleteMakerWorkspaceAssets(this.makerKey, removed).catch(() => {});
    }
  }

  confirmDelete(message) {
    return typeof window.confirm !== 'function' || window.confirm(message);
  }

  handleCreatorClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || button.matches('input,select,textarea,label')) return;
    const action = button.dataset.action;
    const state = this.store?.getState();
    if (!state) return;
    const document = state.document;
    const { part, item, variant, binding } = this.selectedCreatorRecords(document);
    if (action === 'creator-tab') {
      this.creatorTab = button.dataset.tab;
      this.render();
      return;
    }
    if (action === 'select-part') {
      this.selectedPartId = button.dataset.partId;
      this.selectedItemId = '';
      this.selectedVariantId = '';
      this.selectedBindingId = '';
      this.ensureCreatorSelection(document);
      this.render();
      return;
    }
    if (action === 'select-item') {
      const selectedItem = findItem(document, this.selectedPartId, button.dataset.itemId);
      if (!selectedItem) return;
      this.selectedItemId = selectedItem.id;
      this.selectedVariantId = selectedItem.defaultVariantId || selectedItem.variants[0]?.id || '';
      this.selectedBindingId = '';
      this.ensureCreatorSelection(document);
      this.store.execute('Preview Item', (next) => replaceRecipeSelection(next.recipe, {
        partId: this.selectedPartId,
        itemId: selectedItem.id,
        variantId: this.selectedVariantId,
      }));
      return;
    }
    if (action === 'select-variant') {
      this.selectedVariantId = button.dataset.variantId;
      this.selectedBindingId = '';
      this.ensureCreatorSelection(document);
      this.store.execute('Preview Style', (next) => replaceRecipeSelection(next.recipe, {
        partId: this.selectedPartId,
        itemId: this.selectedItemId,
        variantId: this.selectedVariantId,
      }));
      return;
    }
    if (action === 'select-binding') {
      this.selectedBindingId = button.dataset.bindingId;
      const selectedBinding = findBinding(document, this.selectedPartId, this.selectedItemId, this.selectedVariantId, this.selectedBindingId);
      this.selectedTrackId = selectedBinding?.layerTrackId || this.selectedTrackId;
      this.selectedChannelId = selectedBinding?.colorChannelId || this.selectedChannelId;
      this.render();
      return;
    }
    if (action === 'select-track') {
      this.selectedTrackId = button.dataset.trackId;
      this.render();
      return;
    }
    if (action === 'select-channel') {
      this.selectedChannelId = button.dataset.channelId;
      this.render();
      return;
    }
    if (action === 'undo') return void this.store.undo();
    if (action === 'redo') return void this.store.redo();
    if (action === 'save') return void this.save();
    if (action === 'open-player') {
      this.playerRecipe = clone(state.recipe);
      this.playerUndo = [];
      this.playerRedo = [];
      this.playerIntroOpen = true;
      this.callbacks.onOpenPlayer?.({ document: this.runtimeDocument(), recipe: this.playerRecipe, assets: this.assets });
      this.render();
      return;
    }
    if (action === 'publish') {
      const issues = this.publicationIssues(document);
      if (issues.length) {
        this.creatorTab = 'validate';
        this.render();
        return;
      }
      this.callbacks.onPublish?.({ document, recipe: document.defaultRecipe, assets: this.assets, compatibility: this.compatibilityReport(document) });
      return;
    }
    if (action === 'run-preflight') {
      this.creatorTab = 'validate';
      this.render();
      return;
    }
    if (action === 'toggle-solo') {
      this.creatorSolo = !this.creatorSolo;
      this.render();
      return;
    }
    if (action === 'toggle-dim') {
      this.creatorDimOthers = !this.creatorDimOthers;
      this.render();
      return;
    }
    if (action === 'toggle-binding-hidden' && binding) {
      if (this.hiddenBindingIds.has(binding.id)) this.hiddenBindingIds.delete(binding.id);
      else this.hiddenBindingIds.add(binding.id);
      this.render();
      return;
    }
    if (action === 'toggle-pixel') {
      this.executeDocument('Toggle pixel art mode', ({ document: next }) => {
        next.canvas.pixelMode = next.canvas.pixelMode === 'pixelated' ? 'smooth' : 'pixelated';
      });
      return;
    }
    if (action === 'add-part') {
      const nextPart = createPart(document, `Part ${document.parts.length + 1}`);
      this.selectedPartId = nextPart.id;
      this.selectedItemId = '';
      this.executeDocument('Add Part', ({ document: next }) => { next.parts.push(nextPart); });
      return;
    }
    if (action === 'copy-part' && part) {
      this.executeDocument('Duplicate Part', ({ document: next }) => {
        const duplicate = duplicatePart(next, part.id);
        this.selectedPartId = duplicate?.id || this.selectedPartId;
        this.selectedItemId = duplicate?.items[0]?.id || '';
      });
      return;
    }
    if (action === 'delete-part' && part && this.confirmDelete(`Delete “${part.name}” and all of its Items and layers?`)) {
      this.executeDocument('Delete Part', ({ document: next, recipe: nextRecipe }) => {
        next.parts = next.parts.filter((candidate) => candidate.id !== part.id);
        next.parts.forEach((candidate) => {
          if (candidate.parentPartId === part.id) candidate.parentPartId = null;
          candidate.requires = candidate.requires.filter((target) => target.partId !== part.id);
          candidate.excludes = candidate.excludes.filter((target) => target.partId !== part.id);
        });
        replaceRecipeSelection(nextRecipe, { partId: part.id, itemId: '' });
        removeUnreferencedAssetMetadata(next);
      });
      this.selectedPartId = '';
      return;
    }
    if (action === 'add-item' && part) {
      const nextItem = createItem(part, `Item ${part.items.length + 1}`);
      this.selectedItemId = nextItem.id;
      this.selectedVariantId = nextItem.defaultVariantId;
      this.selectedBindingId = '';
      this.executeDocument('Add Item', ({ document: next, recipe: nextRecipe }) => {
        const target = findPart(next, part.id);
        target.items.push(nextItem);
        target.defaultItemId ||= nextItem.id;
        replaceRecipeSelection(nextRecipe, { partId: target.id, itemId: nextItem.id, variantId: nextItem.defaultVariantId });
      });
      return;
    }
    if (action === 'copy-item' && item) {
      this.executeDocument('Duplicate Item', ({ document: next }) => {
        const targetPart = findPart(next, part.id);
        const duplicate = clone(findItem(next, part.id, item.id));
        duplicate.id = uniqueDocumentId(`${item.id}-copy`, [targetPart.items], 'item-copy');
        duplicate.name = `${item.name} Copy`;
        targetPart.items.push(duplicate);
        this.selectedItemId = duplicate.id;
        this.selectedVariantId = duplicate.defaultVariantId;
      });
      return;
    }
    if (action === 'delete-item' && item && this.confirmDelete(`Delete “${item.name}” and all of its styles?`)) {
      this.executeDocument('Delete Item', ({ document: next, recipe: nextRecipe }) => {
        const targetPart = findPart(next, part.id);
        targetPart.items = targetPart.items.filter((candidate) => candidate.id !== item.id);
        if (targetPart.defaultItemId === item.id) targetPart.defaultItemId = targetPart.items[0]?.id || null;
        replaceRecipeSelection(nextRecipe, { partId: part.id, itemId: '' });
        removeUnreferencedAssetMetadata(next);
      });
      this.selectedItemId = '';
      return;
    }
    if (action === 'add-variant' && item) {
      const nextVariant = createVariant(item, `Style ${item.variants.length + 1}`);
      this.selectedVariantId = nextVariant.id;
      this.selectedBindingId = '';
      this.executeDocument('Add Style', ({ document: next }) => findItem(next, part.id, item.id).variants.push(nextVariant));
      return;
    }
    if (action === 'copy-variant' && variant) {
      this.executeDocument('Duplicate Style', ({ document: next }) => {
        const targetItem = findItem(next, part.id, item.id);
        const duplicate = clone(findVariant(next, part.id, item.id, variant.id));
        duplicate.id = uniqueDocumentId(`${variant.id}-copy`, [targetItem.variants], 'style-copy');
        duplicate.name = `${variant.name} Copy`;
        targetItem.variants.push(duplicate);
        this.selectedVariantId = duplicate.id;
      });
      return;
    }
    if (action === 'delete-variant' && variant && item.variants.length > 1 && this.confirmDelete(`Delete style “${variant.name}”?`)) {
      this.executeDocument('Delete Style', ({ document: next }) => {
        const targetItem = findItem(next, part.id, item.id);
        targetItem.variants = targetItem.variants.filter((candidate) => candidate.id !== variant.id);
        if (targetItem.defaultVariantId === variant.id) targetItem.defaultVariantId = targetItem.variants[0]?.id || null;
        removeUnreferencedAssetMetadata(next);
      });
      this.selectedVariantId = '';
      return;
    }
    if (action === 'add-empty-binding' && variant && document.layerTracks.length) {
      this.executeDocument('Add LayerBinding', ({ document: next }) => {
        const target = findVariant(next, part.id, item.id, variant.id);
        const placeholderId = uniqueDocumentId('pending-asset', [next.assets], 'pending-asset');
        target.layerBindings.push(createLayerBinding(target, this.selectedTrackId || next.layerTracks[0].id, placeholderId));
        this.selectedBindingId = target.layerBindings.at(-1).id;
      });
      return;
    }
    if (action === 'delete-binding' && binding) {
      this.executeDocument('Delete LayerBinding', ({ document: next }) => {
        const target = findVariant(next, part.id, item.id, variant.id);
        target.layerBindings = target.layerBindings.filter((candidate) => candidate.id !== binding.id);
        removeUnreferencedAssetMetadata(next);
      });
      this.selectedBindingId = '';
      return;
    }
    if (action === 'confirm-position' && binding) {
      this.executeDocument('Confirm layer position', ({ document: next }) => {
        findBinding(next, part.id, item.id, variant.id, binding.id).positionConfirmed = true;
      });
      return;
    }
    if (action === 'add-track') {
      const track = createLayerTrack(document, `Layer ${document.layerTracks.length + 1}`);
      this.selectedTrackId = track.id;
      this.executeDocument('Add Layer Track', ({ document: next }) => next.layerTracks.push(track));
      return;
    }
    if (action === 'move-track') {
      const index = document.layerTracks.findIndex((track) => track.id === button.dataset.trackId);
      const target = button.dataset.direction === 'up' ? index + 1 : index - 1;
      this.executeDocument('Reorder Layer Tracks', ({ document: next }) => moveArrayEntry(next.layerTracks, index, target));
      return;
    }
    if (action === 'delete-track') {
      const trackId = button.dataset.trackId;
      const used = document.parts.some((candidate) => candidate.items.some((candidateItem) => candidateItem.variants.some((candidateVariant) => candidateVariant.layerBindings.some((candidateBinding) => candidateBinding.layerTrackId === trackId))));
      if (!used) this.executeDocument('Delete Layer Track', ({ document: next }) => { next.layerTracks = next.layerTracks.filter((track) => track.id !== trackId); });
      return;
    }
    if (action === 'add-channel') {
      const channel = createGradientColorChannel(document, `Color ${document.colorChannels.length + 1}`);
      this.selectedChannelId = channel.id;
      this.executeDocument('Add Color Channel', ({ document: next }) => next.colorChannels.push(channel));
      return;
    }
    if (action === 'delete-channel') {
      const channelId = this.selectedChannelId;
      this.executeDocument('Delete Color Channel', ({ document: next }) => {
        next.colorChannels = next.colorChannels.filter((channel) => channel.id !== channelId);
        next.parts.forEach((candidate) => candidate.items.forEach((candidateItem) => candidateItem.variants.forEach((candidateVariant) => candidateVariant.layerBindings.forEach((candidateBinding) => {
          if (candidateBinding.colorChannelId === channelId) {
            candidateBinding.colorChannelId = null;
            candidateBinding.assetsBySwatch = [];
          }
        }))));
      });
      this.selectedChannelId = '';
      return;
    }
    if (action === 'add-swatch') {
      const channel = document.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
      if (!channel) return;
      this.executeDocument('Add Color Preset', ({ document: next }) => {
        const target = next.colorChannels.find((candidate) => candidate.id === channel.id);
        const id = uniqueDocumentId(`color-${target.swatches.length + 1}`, [target.swatches], 'color');
        target.swatches.push({ id, name: `Color ${target.swatches.length + 1}`, hintColor: '#f06f8f', stops: target.mode === 'gradient-map' ? [{ offset: 0, color: '#3d101c' }, { offset: 0.5, color: '#f06f8f' }, { offset: 1, color: '#ffe8ef' }] : [] });
      });
      return;
    }
    if (action === 'delete-swatch') {
      const swatchId = button.dataset.swatchId;
      this.executeDocument('Delete Color Preset', ({ document: next }) => {
        const target = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
        if (!target || target.swatches.length <= 1) return;
        target.swatches = target.swatches.filter((swatch) => swatch.id !== swatchId);
        if (target.defaultSwatchId === swatchId) target.defaultSwatchId = target.swatches[0]?.id || null;
        next.parts.forEach((candidate) => candidate.items.forEach((candidateItem) => candidateItem.variants.forEach((candidateVariant) => candidateVariant.layerBindings.forEach((candidateBinding) => {
          if (candidateBinding.colorChannelId === target.id) candidateBinding.assetsBySwatch = candidateBinding.assetsBySwatch.filter((mapping) => mapping.swatchId !== swatchId);
        }))));
      });
      return;
    }
    if (action === 'add-rule') return void this.addRuleFromBuilder();
    if (action === 'delete-rule') return void this.deleteRule(button.dataset.ruleId);
    if (action === 'add-expansion') {
      const pack = defaultExpansion(document, document.extensions.expansionDrafts.length);
      this.executeDocument('Add Expansion Pack', ({ document: next }) => {
        next.extensions.expansionDrafts.push(pack);
        next.expansionPacks.push({
          id: pack.packId,
          name: pack.name,
          version: 1,
          manifestIdentifier: `expansions/${pack.packId}.json`,
          baseMakerId: next.version.rootMakerId,
          baseMakerVersion: next.version.number,
          required: false,
        });
      });
      return;
    }
    if (action === 'toggle-expansion') {
      const packId = button.dataset.packId;
      if (this.enabledExpansionIds.has(packId)) this.enabledExpansionIds.delete(packId);
      else this.enabledExpansionIds.add(packId);
      this.render();
      return;
    }
    if (action === 'delete-expansion') {
      const packId = button.dataset.packId;
      this.executeDocument('Delete Expansion Pack', ({ document: next }) => {
        next.extensions.expansionDrafts = next.extensions.expansionDrafts.filter((pack) => pack.packId !== packId);
        next.expansionPacks = next.expansionPacks.filter((pack) => pack.id !== packId);
      });
      this.enabledExpansionIds.delete(packId);
      return;
    }
    if (action === 'add-selected-to-expansion') return void this.addSelectedItemToExpansion(button.dataset.packId);
    if (action === 'set-default-recipe') {
      this.executeDocument('Set default recipe', ({ document: next, recipe: nextRecipe }) => {
        next.defaultRecipe = clone(nextRecipe);
        const selections = recipeSelectionMap(nextRecipe);
        next.parts.forEach((candidate) => {
          const selection = selections.get(candidate.id);
          if (!selection) return;
          candidate.defaultItemId = selection.itemId;
          const selectedItem = candidate.items.find((candidateItem) => candidateItem.id === selection.itemId);
          if (selectedItem) selectedItem.defaultVariantId = selection.variantId || selectedItem.defaultVariantId;
        });
        next.colorChannels.forEach((channel) => {
          const selection = nextRecipe.colors?.find((entry) => entry.channelId === channel.id);
          if (selection) channel.defaultSwatchId = selection.swatchId;
        });
      });
      return;
    }
    if (action === 'set-version-compatibility') {
      const compatibility = button.dataset.compatibility === 'breaking' ? 'breaking' : 'compatible';
      this.executeDocument(`Mark update ${compatibility}`, ({ document: next }) => {
        next.version.compatibility = compatibility;
        next.version.compatibleFrom = compatibility === 'breaking'
          ? next.version.number
          : Number(this.context?.publishedDocument?.version?.compatibleFrom || 1);
      });
      return;
    }
    if (action === 'cancel-import') {
      this.pendingImport = null;
      this.render();
      return;
    }
    if (action === 'confirm-import') {
      this.confirmBatchImport();
    }
  }

  handleCreatorInput(event) {
    const action = event.target.dataset.action;
    if (action === 'canvas-zoom') {
      this.creatorZoom = Math.min(2, Math.max(0.5, Number(event.target.value || 100) / 100));
      const canvas = this.creatorRoot?.querySelector('#makerV4CreatorCanvas');
      if (canvas) canvas.style.width = `${Math.round(this.creatorZoom * 100)}%`;
      return;
    }
    if (action === 'binding-scale-preview') {
      this.bindingScalePreview = Math.max(0.01, Number(event.target.value || 100) / 100);
      this.drawCreatorCanvas();
    }
  }

  async handleCreatorChange(event) {
    const input = event.target;
    const action = input.dataset.action;
    if (!action || !this.store) return;
    const state = this.store.getState();
    const document = state.document;
    const { part, item, variant, binding } = this.selectedCreatorRecords(document);
    if (action === 'batch-import') {
      const files = [...(input.files || [])];
      if (!files.length || !variant) return;
      this.pendingImport = {
        partId: part.id,
        itemId: item.id,
        variantId: variant.id,
        mapping: buildAssetImportMapping(files, document.layerTracks),
      };
      this.render();
      return;
    }
    if (action === 'import-track') {
      const mapping = this.pendingImport?.mapping[Number(input.dataset.importIndex)];
      if (mapping) mapping.trackId = input.value;
      return;
    }
    if (action === 'import-track-name') {
      const mapping = this.pendingImport?.mapping[Number(input.dataset.importIndex)];
      if (mapping) mapping.suggestedTrackName = input.value.trim() || mapping.suggestedTrackName;
      return;
    }
    if (action === 'part-icon' && part && input.files?.[0]) {
      const asset = await this.importDisplayAsset(input.files[0], 'part-icon');
      this.executeDocument('Update Part icon', ({ document: next }) => {
        addDocumentAsset(next, asset);
        findPart(next, part.id).iconAssetId = asset.assetId;
        removeUnreferencedAssetMetadata(next);
      });
      return;
    }
    if (action === 'item-thumbnail' && item && input.files?.[0]) {
      const asset = await this.importDisplayAsset(input.files[0], 'thumbnail');
      this.executeDocument('Update Item thumbnail', ({ document: next }) => {
        addDocumentAsset(next, asset);
        findItem(next, part.id, item.id).thumbnailAssetId = asset.assetId;
        removeUnreferencedAssetMetadata(next);
      });
      return;
    }
    if (action === 'binding-asset' && binding && input.files?.[0]) {
      await this.replaceBindingAsset(input.files[0], { partId: part.id, itemId: item.id, variantId: variant.id, bindingId: binding.id });
      return;
    }
    const bool = input.type === 'checkbox' ? input.checked : null;
    if (action === 'part-name' && part) this.executeDocument('Rename Part', ({ document: next }) => { findPart(next, part.id).name = input.value.trim() || part.name; });
    else if (action === 'part-required' && part) this.executeDocument('Change required Part', ({ document: next }) => { findPart(next, part.id).required = bool; });
    else if (action === 'part-visible' && part) this.executeDocument('Change Part menu visibility', ({ document: next }) => { findPart(next, part.id).menuVisible = bool; });
    else if (action === 'part-parent' && part) this.executeDocument('Change Part hierarchy', ({ document: next }) => { findPart(next, part.id).parentPartId = input.value || null; });
    else if (action === 'part-default' && part) this.executeDocument('Change default Item', ({ document: next }) => {
      const target = findPart(next, part.id);
      target.defaultItemId = input.value || null;
      const selectedItem = target.items.find((candidate) => candidate.id === target.defaultItemId);
      const selection = next.defaultRecipe.selections.find((candidate) => candidate.partId === target.id);
      if (selectedItem && selection) {
        selection.itemId = selectedItem.id;
        selection.variantId = selectedItem.defaultVariantId || selectedItem.variants[0]?.id;
      }
    });
    else if (action === 'item-name' && item) this.executeDocument('Rename Item', ({ document: next }) => { findItem(next, part.id, item.id).name = input.value.trim() || item.name; });
    else if (action === 'variant-name' && variant) this.executeDocument('Rename Style', ({ document: next }) => { findVariant(next, part.id, item.id, variant.id).name = input.value.trim() || variant.name; });
    else if (action === 'binding-track' && binding) this.executeDocument('Bind Layer Track', ({ document: next }) => { findBinding(next, part.id, item.id, variant.id, binding.id).layerTrackId = input.value; });
    else if (['binding-x', 'binding-y', 'binding-scale', 'binding-rotation'].includes(action) && binding) {
      const field = action.replace('binding-', '');
      this.executeDocument('Edit layer transform', ({ document: next }) => {
        const target = findBinding(next, part.id, item.id, variant.id, binding.id);
        target.transform[field] = field === 'scale' ? Math.max(0.01, Number(input.value || 1)) : Number(input.value || 0);
        target.positionConfirmed = true;
      });
    } else if (action === 'binding-scale-preview' && binding) {
      const scale = Math.max(0.01, Number(input.value || 100) / 100);
      this.bindingScalePreview = null;
      this.executeDocument('Scale layer on Canvas', ({ document: next }) => {
        const target = findBinding(next, part.id, item.id, variant.id, binding.id);
        target.transform.scale = scale;
        target.positionConfirmed = true;
      });
    } else if (action === 'binding-opacity' && binding) this.executeDocument('Change layer opacity', ({ document: next }) => { findBinding(next, part.id, item.id, variant.id, binding.id).opacity = Number(input.value || 0) / 100; });
    else if (action === 'binding-blend' && binding) this.executeDocument('Change blend mode', ({ document: next }) => { findBinding(next, part.id, item.id, variant.id, binding.id).blendMode = input.value; });
    else if (action === 'binding-channel' && binding) this.executeDocument('Bind smart color', ({ document: next }) => {
      const target = findBinding(next, part.id, item.id, variant.id, binding.id);
      target.colorChannelId = input.value || null;
      const channel = next.colorChannels.find((candidate) => candidate.id === target.colorChannelId);
      target.assetsBySwatch = channel?.mode === 'asset-map' ? channel.swatches.map((swatch) => ({ swatchId: swatch.id, assetId: target.assetId })) : [];
    });
    else if (action === 'binding-visible-when' && binding) this.executeDocument('Change layer visibility rule', ({ document: next }) => {
      findBinding(next, part.id, item.id, variant.id, binding.id).visibleWhen = input.value ? { op: 'selected', partId: input.value } : null;
    });
    else if (action === 'track-name') this.executeDocument('Rename Layer Track', ({ document: next }) => {
      const track = next.layerTracks.find((candidate) => candidate.id === input.dataset.trackId);
      if (track) track.name = input.value.trim() || track.name;
    });
    else if (action === 'channel-name') this.executeDocument('Rename Color Channel', ({ document: next }) => {
      const channel = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
      if (channel) channel.name = input.value.trim() || channel.name;
    });
    else if (action === 'channel-mode') this.executeDocument('Change Color Channel mode', ({ document: next }) => {
      const channel = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
      if (!channel) return;
      channel.mode = input.value;
      channel.swatches.forEach((swatch) => {
        swatch.stops = channel.mode === 'gradient-map' && swatch.stops.length < 2
          ? [{ offset: 0, color: '#151020' }, { offset: 0.5, color: swatch.hintColor }, { offset: 1, color: '#ffffff' }]
          : channel.mode === 'asset-map' ? [] : swatch.stops;
      });
      next.parts.forEach((candidate) => candidate.items.forEach((candidateItem) => candidateItem.variants.forEach((candidateVariant) => candidateVariant.layerBindings.forEach((candidateBinding) => {
        if (candidateBinding.colorChannelId !== channel.id) return;
        candidateBinding.assetsBySwatch = channel.mode === 'asset-map'
          ? channel.swatches.map((swatch) => ({ swatchId: swatch.id, assetId: candidateBinding.assetId }))
          : [];
      }))));
    });
    else if (action === 'channel-default-swatch') this.executeDocument('Change default color', ({ document: next }) => {
      const channel = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
      channel.defaultSwatchId = input.value;
      const selection = next.defaultRecipe.colors.find((entry) => entry.channelId === channel.id);
      if (selection) selection.swatchId = input.value;
    });
    else if (['swatch-name', 'swatch-hint', 'swatch-stop', 'swatch-mid'].includes(action)) {
      this.executeDocument('Edit smart color preset', ({ document: next }) => {
        const channel = next.colorChannels.find((candidate) => candidate.id === this.selectedChannelId);
        const swatch = channel?.swatches.find((candidate) => candidate.id === input.dataset.swatchId);
        if (!swatch) return;
        if (action === 'swatch-name') swatch.name = input.value.trim() || swatch.name;
        else if (action === 'swatch-hint') swatch.hintColor = input.value;
        else if (action === 'swatch-stop') swatch.stops[Number(input.dataset.stopIndex)].color = input.value;
        else {
          const middle = Math.floor((swatch.stops.length - 1) / 2);
          if (swatch.stops.length === 2) swatch.stops.splice(1, 0, { offset: 0.5, color: input.value });
          else swatch.stops[middle].color = input.value;
        }
      });
    }
  }

  async importDisplayAsset(file, kind) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose a PNG or JPEG image.');
    if (Number(file.size || 0) > 5 * 1024 * 1024) throw new Error('Icons and thumbnails must be 5 MB or smaller.');
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    const assetId = createAssetId(kind);
    const record = runtimeAssetRecord({ assetId, blob: file, fileName: file.name, width, height, source: 'local' });
    record.kind = kind;
    record.identifier = `${safeFileName(file.name, assetId)}-${assetId.slice(-8)}.${String(file.type).includes('jpeg') ? 'jpg' : 'png'}`;
    this.assets.set(assetId, record);
    await upsertMakerWorkspaceAssets(this.makerKey, [{ ...record, url: '', thumbnailUrl: '' }]);
    this.assetResolver.clear();
    this.assetResolver = createCachedAssetResolver(this.assets);
    return record;
  }

  async replaceBindingAsset(file, selection) {
    const inspection = await inspectPngAsset(file, this.store.getState().document.canvas);
    const thumbnailBlob = await createAlphaCroppedThumbnail(file);
    const assetId = createAssetId(file.name);
    const record = runtimeAssetRecord({ assetId, blob: file, fileName: file.name, width: inspection.width, height: inspection.height, thumbnailBlob });
    record.kind = 'layer';
    record.identifier = `${safeFileName(file.name, assetId)}-${assetId.slice(-8)}.png`;
    this.assets.set(assetId, record);
    await upsertMakerWorkspaceAssets(this.makerKey, [{ ...record, url: '', thumbnailUrl: '' }]);
    this.assetResolver.clear();
    this.assetResolver = createCachedAssetResolver(this.assets);
    this.executeDocument('Replace layer PNG', ({ document }) => {
      addDocumentAsset(document, record);
      const binding = findBinding(document, selection.partId, selection.itemId, selection.variantId, selection.bindingId);
      binding.assetId = assetId;
      binding.transform = {
        x: inspection.initialTransform.x,
        y: inspection.initialTransform.y,
        scale: inspection.initialTransform.scaleX,
        rotation: 0,
      };
      binding.positionConfirmed = inspection.fullCanvas;
      if (binding.colorChannelId) {
        const channel = document.colorChannels.find((candidate) => candidate.id === binding.colorChannelId);
        binding.assetsBySwatch = channel?.mode === 'asset-map' ? channel.swatches.map((swatch) => ({ swatchId: swatch.id, assetId })) : [];
      }
      removeUnreferencedAssetMetadata(document);
    });
  }

  async confirmBatchImport() {
    const pending = this.pendingImport;
    if (!pending || !this.store) return;
    this.store.setSaveState('saving', `Inspecting ${pending.mapping.length} PNG files…`);
    try {
      const canvas = this.store.getState().document.canvas;
      const prepared = await Promise.all(pending.mapping.map(async (mapping) => {
        const inspection = await inspectPngAsset(mapping.file, canvas);
        const thumbnailBlob = await createAlphaCroppedThumbnail(mapping.file);
        const assetId = createAssetId(mapping.fileName);
        const record = runtimeAssetRecord({
          assetId,
          blob: mapping.file,
          fileName: mapping.fileName,
          width: inspection.width,
          height: inspection.height,
          thumbnailBlob,
        });
        record.kind = 'layer';
        record.identifier = `${safeFileName(mapping.fileName, assetId)}-${assetId.slice(-8)}.png`;
        return { mapping, inspection, record };
      }));
      prepared.forEach(({ record }) => this.assets.set(record.assetId, record));
      await upsertMakerWorkspaceAssets(this.makerKey, prepared.map(({ record }) => ({ ...record, url: '', thumbnailUrl: '' })));
      this.assetResolver.clear();
      this.assetResolver = createCachedAssetResolver(this.assets);
      this.executeDocument(`Batch import ${prepared.length} PNG layers`, ({ document }) => {
        const targetItem = findItem(document, pending.partId, pending.itemId);
        const targetVariant = findVariant(document, pending.partId, pending.itemId, pending.variantId);
        prepared.forEach(({ mapping, inspection, record }) => {
          let trackId = mapping.trackId;
          if (!trackId || !document.layerTracks.some((track) => track.id === trackId)) {
            const track = createLayerTrack(document, mapping.suggestedTrackName || `Layer ${document.layerTracks.length + 1}`);
            document.layerTracks.push(track);
            trackId = track.id;
          }
          addDocumentAsset(document, record);
          let targetBinding = targetVariant.layerBindings.find((candidate) => candidate.layerTrackId === trackId);
          if (!targetBinding) {
            targetBinding = createLayerBinding(targetVariant, trackId, record.assetId, {
              x: inspection.initialTransform.x,
              y: inspection.initialTransform.y,
              scale: inspection.initialTransform.scaleX,
            });
            targetVariant.layerBindings.push(targetBinding);
          } else {
            targetBinding.assetId = record.assetId;
            targetBinding.transform = {
              x: inspection.initialTransform.x,
              y: inspection.initialTransform.y,
              scale: inspection.initialTransform.scaleX,
              rotation: 0,
            };
          }
          targetBinding.positionConfirmed = inspection.fullCanvas;
          this.selectedBindingId = targetBinding.id;
        });
        targetItem.thumbnailAssetId ||= prepared[0]?.record.assetId || null;
        removeUnreferencedAssetMetadata(document);
      });
      this.pendingImport = null;
      this.store.setSaveState('dirty', `${prepared.length} PNG layer${prepared.length === 1 ? '' : 's'} imported`);
      this.render();
    } catch (error) {
      this.store.setSaveState('error', error.message || 'Batch import failed.');
    }
  }

  addRuleFromBuilder() {
    const document = this.store.getState().document;
    const ownerPartId = this.creatorRoot.querySelector('#v4RuleOwnerPart')?.value || this.selectedPartId;
    const ownerScope = this.creatorRoot.querySelector('#v4RuleOwnerScope')?.value || 'part';
    const type = this.creatorRoot.querySelector('#v4RuleType')?.value || 'excludes';
    const [targetPartId = '', targetItemId = '', targetVariantId = ''] = String(this.creatorRoot.querySelector('#v4RuleTargetDefinition')?.value || '').split('::');
    if (!ownerPartId || !targetPartId || ownerPartId === targetPartId) return;
    this.executeDocument(`Add ${type} rule`, ({ document: next }) => {
      const ownerPart = findPart(next, ownerPartId);
      let owner = ownerPart;
      if (ownerScope === 'item') owner = ownerPart.items.find((candidate) => candidate.id === (ownerPartId === this.selectedPartId ? this.selectedItemId : ownerPart.defaultItemId)) || ownerPart;
      if (ownerScope === 'variant' && owner !== ownerPart) owner = owner.variants.find((candidate) => candidate.id === (ownerPartId === this.selectedPartId ? this.selectedVariantId : owner.defaultVariantId)) || owner;
      const target = {
        partId: targetPartId,
        ...(targetItemId ? { itemId: targetItemId } : {}),
        ...(targetVariantId ? { variantId: targetVariantId } : {}),
      };
      owner[type] ||= [];
      if (!owner[type].some((candidate) => candidate.partId === target.partId
        && String(candidate.itemId || '') === targetItemId
        && String(candidate.variantId || '') === targetVariantId)) owner[type].push(target);
    });
  }

  deleteRule(ruleId) {
    const row = ownerRuleRows(this.store.getState().document).find((candidate) => candidate.id === ruleId);
    if (!row) return;
    this.executeDocument('Delete selection rule', ({ document }) => {
      const ownerPart = findPart(document, row.ownerPartId);
      const ownerItem = row.ownerItemId ? findItem(document, row.ownerPartId, row.ownerItemId) : null;
      const ownerVariant = row.ownerVariantId ? findVariant(document, row.ownerPartId, row.ownerItemId, row.ownerVariantId) : null;
      const owner = ownerVariant || ownerItem || ownerPart;
      owner[row.type].splice(row.index, 1);
    });
  }

  addSelectedItemToExpansion(packId) {
    const state = this.store.getState();
    const document = state.document;
    const part = findPart(document, this.selectedPartId);
    const item = findItem(document, this.selectedPartId, this.selectedItemId);
    if (!part || !item) return;
    this.executeDocument('Add Item to Expansion Pack', ({ document: next }) => {
      const pack = next.extensions.expansionDrafts.find((candidate) => candidate.packId === packId);
      if (!pack) return;
      let extension = pack.parts.find((candidate) => candidate.extendsPartId === part.id);
      if (!extension) {
        extension = { id: `extend-${part.id}`, name: `${part.name} additions`, extendsPartId: part.id, items: [] };
        pack.parts.push(extension);
      }
      const copy = clone(item);
      copy.id = uniqueDocumentId(`${item.id}-pack`, [extension.items], 'pack-item');
      copy.name = `${item.name} Pack`;
      extension.items.push(copy);
      const bindings = copy.variants.flatMap((candidate) => candidate.layerBindings);
      const trackIds = new Set(bindings.map((candidate) => candidate.layerTrackId));
      const assetIds = new Set(bindings.flatMap((candidate) => [candidate.assetId, ...(candidate.assetsBySwatch || []).map((mapping) => mapping.assetId)]));
      const channelIds = new Set(bindings.map((candidate) => candidate.colorChannelId).filter(Boolean));
      next.layerTracks.filter((track) => trackIds.has(track.id)).forEach((track) => {
        if (!pack.layerTracks.some((candidate) => candidate.id === track.id)) pack.layerTracks.push(clone(track));
      });
      next.assets.filter((asset) => assetIds.has(asset.id)).forEach((asset) => {
        if (!pack.assets.some((candidate) => candidate.id === asset.id)) pack.assets.push(clone(asset));
      });
      next.colorChannels.filter((channel) => channelIds.has(channel.id)).forEach((channel) => {
        if (!pack.colorChannels.some((candidate) => candidate.id === channel.id)) pack.colorChannels.push(clone(channel));
      });
    });
  }

  handleDragStart(event) {
    const target = event.target.closest('[data-drag-kind]');
    if (!target) return;
    this.dragSort = {
      kind: target.dataset.dragKind,
      id: target.dataset.dragId,
      parentId: target.dataset.parentId || '',
    };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(this.dragSort));
  }

  handleDragOver(event) {
    if (event.target.closest('[data-drag-kind]')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  handleDrop(event) {
    const target = event.target.closest('[data-drag-kind]');
    if (!target || !this.dragSort || target.dataset.dragKind !== this.dragSort.kind) return;
    event.preventDefault();
    const targetId = target.dataset.dragId;
    const source = this.dragSort;
    this.dragSort = null;
    if (!targetId || targetId === source.id) return;
    this.executeDocument(`Reorder ${source.kind}`, ({ document }) => {
      let entries = [];
      if (source.kind === 'part') entries = document.parts;
      else if (source.kind === 'track') entries = document.layerTracks;
      else if (source.kind === 'item') entries = findPart(document, source.parentId)?.items || [];
      else if (source.kind === 'variant') {
        const [partId, itemId] = source.parentId.split('/');
        entries = findItem(document, partId, itemId)?.variants || [];
      }
      const from = entries.findIndex((entry) => entry.id === source.id);
      const to = entries.findIndex((entry) => entry.id === targetId);
      moveArrayEntry(entries, from, to);
    });
  }

  setPlayerRecipe(nextRecipe, label) {
    const previous = clone(this.playerRecipe);
    this.playerUndo.push({ label, recipe: previous });
    if (this.playerUndo.length > 100) this.playerUndo.shift();
    this.playerRedo = [];
    this.playerRecipe = recipeWithColors(this.runtimeDocument(), nextRecipe);
    this.sessionAutosave();
    this.callbacks.onPlayerRecipeChange?.({ document: this.runtimeDocument(), recipe: this.playerRecipe, profile: this.playerProfile });
    this.render();
  }

  normalizedPlayerSelection(partId, itemId, variantId) {
    const desired = clone(this.playerRecipe);
    replaceRecipeSelection(desired, { partId, itemId, variantId });
    const result = normalizeRecipe(this.runtimeDocument(), desired, { preferPartId: partId });
    return result.valid ? result.documentRecipe : desired;
  }

  handlePlayerClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || button.matches('input,select,textarea,label')) return;
    const action = button.dataset.action;
    const document = this.runtimeDocument();
    if (!document) return;
    const parts = this.activePlayerParts(document);
    const part = parts.find((candidate) => candidate.id === this.playerPartId) || parts[0];
    const selections = recipeSelectionMap(this.playerRecipe);
    const current = selections.get(part?.id);
    const item = part?.items.find((candidate) => candidate.id === current?.itemId);
    if (action === 'player-part') {
      this.playerPartId = button.dataset.partId;
      this.render();
      return;
    }
    if (action === 'player-item' && part) {
      const nextItem = part.items.find((candidate) => candidate.id === button.dataset.itemId);
      if (!nextItem) return;
      this.setPlayerRecipe(this.normalizedPlayerSelection(part.id, nextItem.id, nextItem.defaultVariantId || nextItem.variants[0]?.id), `Choose ${nextItem.name}`);
      return;
    }
    if (action === 'player-variant' && part && item) {
      this.setPlayerRecipe(this.normalizedPlayerSelection(part.id, item.id, button.dataset.variantId), `Choose style ${button.textContent.trim()}`);
      return;
    }
    if (action === 'player-none' && part && !part.required) {
      const next = clone(this.playerRecipe);
      const removeIds = new Set([part.id]);
      let changed = true;
      while (changed) {
        changed = false;
        document.parts.forEach((candidate) => {
          if (candidate.parentPartId && removeIds.has(candidate.parentPartId) && !removeIds.has(candidate.id)) {
            removeIds.add(candidate.id);
            changed = true;
          }
        });
      }
      next.selections = next.selections.filter((selection) => !removeIds.has(selection.partId));
      this.setPlayerRecipe(next, `Remove ${part.name}`);
      return;
    }
    if (action === 'player-color') {
      const next = clone(this.playerRecipe);
      next.colors ||= [];
      const index = next.colors.findIndex((entry) => entry.channelId === button.dataset.channelId);
      const selection = { channelId: button.dataset.channelId, swatchId: button.dataset.swatchId };
      if (index >= 0) next.colors[index] = selection;
      else next.colors.push(selection);
      this.setPlayerRecipe(next, 'Change color');
      return;
    }
    if (action === 'player-undo') {
      const command = this.playerUndo.pop();
      if (!command) return;
      this.playerRedo.push({ label: command.label, recipe: clone(this.playerRecipe) });
      this.playerRecipe = command.recipe;
      this.sessionAutosave();
      this.render();
      return;
    }
    if (action === 'player-redo') {
      const command = this.playerRedo.pop();
      if (!command) return;
      this.playerUndo.push({ label: command.label, recipe: clone(this.playerRecipe) });
      this.playerRecipe = command.recipe;
      this.sessionAutosave();
      this.render();
      return;
    }
    if (action === 'player-reset') {
      this.setPlayerRecipe(clone(document.defaultRecipe), 'Reset OC');
      return;
    }
    if (action === 'player-clear') {
      const next = clone(this.playerRecipe);
      const requiredIds = new Set(document.parts.filter((candidate) => candidate.required).map((candidate) => candidate.id));
      next.selections = next.selections.filter((selection) => requiredIds.has(selection.partId));
      const normalized = normalizeRecipe(document, next, { lockedPartIds: [...requiredIds] });
      this.setPlayerRecipe(normalized.valid ? normalized.documentRecipe : next, 'Remove optional Parts');
      return;
    }
    if (action === 'player-random') {
      try {
        const result = generateValidRecipe(document);
        this.setPlayerRecipe(result.documentRecipe || { selections: result.recipe, colors: this.playerRecipe.colors }, 'Random OC');
      } catch (error) {
        this.callbacks.onPlayerError?.(error);
      }
      return;
    }
    if (action === 'player-info') {
      this.playerIntroOpen = true;
      this.render();
      return;
    }
    if (action === 'close-player-info') {
      this.playerIntroOpen = false;
      this.sessionAutosave();
      this.render();
      return;
    }
    if (action === 'player-export') {
      const payload = { schemaVersion: 'animacraft.player-recipe.v4', makerVersionId: document.version.versionId, recipe: this.playerRecipe, profile: this.playerProfile };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement('a');
      link.href = url;
      link.download = `${safeFileName(this.playerProfile.name, 'oc')}-recipe.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.callbacks.onExportRecipe?.(payload);
      return;
    }
    if (action === 'player-complete') {
      this.callbacks.onCompleteOc?.({ document, recipe: this.playerRecipe, profile: this.playerProfile, assets: this.assets });
    }
  }

  handlePlayerChange(event) {
    const input = event.target;
    const action = input.dataset.action;
    if (!action) return;
    if (action === 'player-profile-name') this.playerProfile.name = input.value;
    else if (action === 'player-profile-world') this.playerProfile.world = input.value;
    else if (action === 'player-expansion') {
      if (input.checked) this.enabledExpansionIds.add(input.value);
      else this.enabledExpansionIds.delete(input.value);
      const normalized = normalizeRecipe(this.runtimeDocument(), this.playerRecipe);
      if (normalized.valid) this.playerRecipe = normalized.documentRecipe;
      this.render();
    }
    this.sessionAutosave();
    this.callbacks.onPlayerRecipeChange?.({ document: this.runtimeDocument(), recipe: this.playerRecipe, profile: this.playerProfile });
  }

  destroy() {
    this.unsubscribe?.();
    this.assetResolver.clear();
    this.assets.forEach(revokeRuntimeAsset);
    this.renderAbort.creator?.abort();
    this.renderAbort.player?.abort();
  }
}

export function createMakerWorkspace(options) {
  return new MakerWorkspace(options);
}
