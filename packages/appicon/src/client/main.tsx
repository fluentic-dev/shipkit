import { StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { createRoot } from 'react-dom/client';
import {
  type AppIconArchive,
  createGeneratedArchive,
  createGeneratedAssetFiles,
  createStateArchive,
  dataUrlBase64,
  iconsFromGeneratedArchive
} from '../shared/archive.js';
import {
  type GeneratedIcon,
  type IconGenerationOptions,
  type IconPlatform,
  type IconStylePlatform,
  type IconShape,
  type IconSourceOverrides,
  type IconStyleOptions,
  type IconStyleScopeMode,
  type IconTarget,
  iconTargets
} from '../shared/icons.js';
import './styles.css';

const baseOptions: IconStyleOptions = {
  background: '#5f4bf4',
  backgroundAngle: 135,
  backgroundEnd: '#00d4ff',
  backgroundMode: 'none',
  borderAngle: 135,
  borderColor: '#ffffff',
  borderEnd: '#6d5dfc',
  borderMode: 'none',
  borderRadius: 22,
  borderSize: 2,
  borderStyle: 'solid',
  padding: 0,
  scale: 100,
  shadow: 12,
  shape: 'original'
};

const defaultOptions: IconGenerationOptions = {
  ...baseOptions,
  backgroundScopeMode: 'single',
  borderScopeMode: 'single',
  platformStyles: {},
  platforms: ['android', 'ios'],
  shapeScopeMode: 'single',
  sourceScopeMode: 'single',
  targetStyles: {}
};

const shipkitUrl = 'http://fluenticstack.com/shipkit';
const showShipkitPromo = import.meta.env.VITE_SHIPKIT_PROMO === 'true';
const storageKey = 'shipkit-appicon-state';
const catalogPreviewCssSize = 72;
const phonePreviewCssSize = 52;
const androidPhonePreviewCssSize = 46;
const maxPreviewDpr = 3;
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const resizedSourceCache = new Map<string, Promise<string>>();
const backgroundPalette = [
  ['#5f4bf4', '#00d4ff'],
  ['#2563eb', '#22c55e'],
  ['#0f766e', '#a3e635'],
  ['#16a34a', '#facc15'],
  ['#f59e0b', '#ec4899'],
  ['#ef4444', '#7c3aed'],
  ['#d946ef', '#06b6d4'],
  ['#ffffff', '#c7d2fe'],
  ['#334155', '#38bdf8'],
  ['#020617', '#8b5cf6']
] as const;
const borderPalette = [
  ['#ffffff', '#5f4bf4'],
  ['#f8fafc', '#06b6d4'],
  ['#fef3c7', '#f97316'],
  ['#dcfce7', '#16a34a'],
  ['#fee2e2', '#e11d48'],
  ['#f5d0fe', '#9333ea'],
  ['#67e8f9', '#1d4ed8'],
  ['#facc15', '#ec4899'],
  ['#cbd5e1', '#334155'],
  ['#111827', '#ffffff']
] as const;
const groupOrder = ['iOS iPhone', 'iOS iPad', 'Android adaptive foreground', 'Android rounded', 'Android legacy'];
const allTargetIds = iconTargets.map((target) => target.id);
const squircleCornerMax = 50;
const shapePresetGroups: Partial<Record<IconShape, ShapePreset[]>> = {
  organic: [
    { label: 'Default', borderRadius: 28, shadow: 12 },
    { label: 'iOS', borderRadius: 30, shadow: 18 },
    { label: 'Android', borderRadius: 24, shadow: 10 },
    { label: 'Soft', borderRadius: 34, shadow: 22 }
  ],
  square: [
    { label: 'Default', borderRadius: 0 },
    { label: 'iOS', borderRadius: 22 },
    { label: 'Android', borderRadius: 12 },
    { label: 'Soft', borderRadius: 28 }
  ],
  squircle: [
    { label: 'Default', borderRadius: 24, shadow: 18 },
    { label: 'iOS', borderRadius: 30, shadow: 22 },
    { label: 'Android', borderRadius: 34, shadow: 24 },
    { label: 'Smooth', borderRadius: 36, shadow: 28 }
  ]
};

type SourceSnapshot = {
  dataUrl: string;
  name: string;
  type: string;
};

type StoredState = {
  collapsedGroups?: Record<string, boolean>;
  options: IconGenerationOptions;
  source: SourceSnapshot | null;
  sourceOverrides: IconSourceOverrides;
};

type MainTab = 'all' | 'android' | 'ios' | 'preview';
type AndroidPreviewVariant = 'default' | 'rounded';
type PanelKind = 'background' | 'border' | 'shape';
type ShapePreset = {
  borderRadius: number;
  label: string;
  shadow?: number;
};
type CornerRadii = {
  bottomLeft: number;
  bottomRight: number;
  topLeft: number;
  topRight: number;
};
type PreviewSelection = {
  dataUrl: string | null;
  source: SourceSnapshot | null;
  style: IconStyleOptions;
  target: IconTarget;
};

function App() {
  const stored = useMemo(readStoredState, []);
  const [source, setSource] = useState<SourceSnapshot | null>(stored.source);
  const [sourceOverrides, setSourceOverrides] = useState<IconSourceOverrides>(stored.sourceOverrides);
  const [options, setOptions] = useState(stored.options);
  const [icons, setIcons] = useState<GeneratedIcon[]>([]);
  const [catalogPreviewIcons, setCatalogPreviewIcons] = useState<GeneratedIcon[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('preview');
  const [sourcePlatform, setSourcePlatform] = useState<IconStylePlatform>('ios');
  const [shapePlatform, setShapePlatform] = useState<IconStylePlatform>('ios');
  const [backgroundPlatform, setBackgroundPlatform] = useState<IconStylePlatform>('ios');
  const [borderPlatform, setBorderPlatform] = useState<IconStylePlatform>('ios');
  const [downloadTargetIds, setDownloadTargetIds] = useState<Set<string>>(() => new Set(allTargetIds));
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [isStateMenuOpen, setIsStateMenuOpen] = useState(false);
  const stateMenuRef = useRef<HTMLDivElement | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    stored.collapsedGroups ?? {}
  );

  const activeTargets = useMemo(() => {
    return iconTargets.filter((target) =>
      mainTab === 'all' || mainTab === 'preview' || target.platform === mainTab
    );
  }, [mainTab]);
  const displayIcons = catalogPreviewIcons.length > 0 ? catalogPreviewIcons : makePreviewIcons(options);
  const visibleIcons = displayIcons.filter((icon) =>
    activeTargets.some((target) => target.id === icon.id)
  );
  const groupedIcons = useMemo(() => groupGeneratedIcons(visibleIcons), [visibleIcons]);
  const downloadTargets = useMemo(
    () => iconTargets.filter((target) => options.platforms.includes(target.platform)),
    [options.platforms]
  );
  const groupedDownloadTargets = useMemo(() => groupGeneratedIcons(downloadTargets), [downloadTargets]);
  const iosPreviewTarget = iconTargets.find((target) => target.id === 'ios-app-60-3x') ?? iconTargets[0]!;
  const androidPreviewTarget = iconTargets.find((target) => target.id === 'android-xxxhdpi') ?? iconTargets[0]!;
  const androidRoundedPreviewTarget = iconTargets.find((target) => target.id === 'android-rounded-xxxhdpi') ?? androidPreviewTarget;
  const previewTargets = useMemo(() => {
    if (mainTab === 'preview') {
      return [iosPreviewTarget, androidPreviewTarget, androidRoundedPreviewTarget]
        .filter((target, index, targets) =>
          options.platforms.includes(target.platform)
          && targets.findIndex((item) => item.id === target.id) === index
        );
    }

    return activeTargets.filter((target) => options.platforms.includes(target.platform));
  }, [activeTargets, androidPreviewTarget, androidRoundedPreviewTarget, iosPreviewTarget, mainTab, options.platforms]);
  const iosPreviewStyle = styleForTarget(options, iosPreviewTarget.id, iosPreviewTarget.platform, iosPreviewTarget.stylePlatform);
  const androidPreviewStyle = styleForTarget(options, androidPreviewTarget.id, androidPreviewTarget.platform, androidPreviewTarget.stylePlatform);
  const androidRoundedPreviewStyle = styleForTarget(
    options,
    androidRoundedPreviewTarget.id,
    androidRoundedPreviewTarget.platform,
    androidRoundedPreviewTarget.stylePlatform
  );
  const iosPreviewSource = sourceForTargetSnapshot(
    source,
    sourceOverrides,
    iosPreviewTarget.id,
    iosPreviewTarget.platform,
    iosPreviewTarget.stylePlatform
  );
  const androidPreviewSource = sourceForTargetSnapshot(
    source,
    sourceOverrides,
    androidPreviewTarget.id,
    androidPreviewTarget.platform,
    androidPreviewTarget.stylePlatform
  );
  const androidRoundedPreviewSource = sourceForTargetSnapshot(
    source,
    sourceOverrides,
    androidRoundedPreviewTarget.id,
    androidRoundedPreviewTarget.platform,
    androidRoundedPreviewTarget.stylePlatform
  );
  const iosPreviewDataUrl = catalogPreviewIcons.find((icon) => icon.id === iosPreviewTarget.id)?.dataUrl ?? null;
  const androidPreviewDataUrl = catalogPreviewIcons.find((icon) => icon.id === androidPreviewTarget.id)?.dataUrl ?? null;
  const androidRoundedPreviewDataUrl = catalogPreviewIcons.find((icon) => icon.id === androidRoundedPreviewTarget.id)?.dataUrl ?? null;
  const sourceHeaderGraphic = (options.sourceScopeMode ?? 'single') === 'multi'
    ? sourceForStylePlatformSnapshot(source, sourceOverrides, sourcePlatform)
    : source;
  const downloadSelectedCount = downloadTargets.filter((target) => downloadTargetIds.has(target.id)).length;

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        collapsedGroups,
        options,
        source,
        sourceOverrides
      } satisfies StoredState)
    );
  }, [collapsedGroups, options, source, sourceOverrides]);

  useEffect(() => {
    setIcons([]);
  }, [options, sourceOverrides]);

  useEffect(() => {
    let isCancelled = false;

    async function renderCatalogPreviews() {
      if (!hasAnySource(source, sourceOverrides)) {
        setCatalogPreviewIcons([]);
        return;
      }

      setCatalogPreviewIcons([]);

      try {
        const nextIcons = await generateCatalogPreviewIcons(source, options, sourceOverrides, previewTargets, mainTab);
        if (!isCancelled) setCatalogPreviewIcons(nextIcons);
      } catch {
        if (!isCancelled) setCatalogPreviewIcons([]);
      }
    }

    void renderCatalogPreviews();

    return () => {
      isCancelled = true;
    };
  }, [mainTab, options, previewTargets, source, sourceOverrides]);

  useEffect(() => {
    if (!isStateMenuOpen) return;

    function closeOnOutside(event: PointerEvent) {
      if (!stateMenuRef.current?.contains(event.target as Node)) {
        setIsStateMenuOpen(false);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setIsStateMenuOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isStateMenuOpen]);

  async function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const nextSource = {
      dataUrl: await fileToDataUrl(nextFile),
      name: nextFile.name,
      type: nextFile.type || 'application/octet-stream'
    };
    if ((options.sourceScopeMode ?? 'single') === 'multi') {
      setSource((current) => current ?? nextSource);
      setSourceOverrides((current) => ({
        ...current,
        platformSources: {
          ...current.platformSources,
          [sourcePlatform]: nextSource.dataUrl
        }
      }));
    } else {
      setSource(nextSource);
    }
    setIcons([]);
    setError(null);
  }

  async function generate() {
    if (!hasAnySource(source, sourceOverrides)) {
      setError('Select a source image first.');
      return [];
    }

    setIsGenerating(true);
    setError(null);

    try {
      const nextIcons = await generateIconsInBrowser(source, options, sourceOverrides);
      setIcons(nextIcons);
      return nextIcons;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not generate icons.');
      return [];
    } finally {
      setIsGenerating(false);
    }
  }

  async function downloadArchive(kind: 'generated' | 'state', targetIds?: Set<string>) {
    if (kind === 'generated' && !hasAnySource(source, sourceOverrides)) {
      setError('Select a source image first.');
      return;
    }

    const generatedIcons = kind === 'generated'
      ? (icons.length > 0 ? icons : await generate()).filter((icon) => (targetIds ?? new Set(allTargetIds)).has(icon.id))
      : icons;
    if (kind === 'generated' && generatedIcons.length === 0) return;

    const generated = createGeneratedArchive(generatedIcons);
    if (kind === 'generated') {
      await downloadBlob(
        await createTarGzipBlob(createGeneratedAssetFiles(generatedIcons)),
        'shipkit-appicon.tar.gz'
      );
      return;
    }

    const archive = createStateArchive({
      generated,
      options,
      source: source ? {
        data: dataUrlBase64(source.dataUrl),
        name: source.name,
        type: source.type
      } : null,
      sourceOverrides
    });
    await downloadBlob(
      await gzipJson(archive),
      'shipkit-appicon.state.gz'
    );
  }

  function openDownloadDialog() {
    if (!hasAnySource(source, sourceOverrides)) {
      setError('Select a source image first.');
      return;
    }

    setError(null);
    setDownloadTargetIds(new Set(downloadTargets.map((target) => target.id)));
    setIsDownloadDialogOpen(true);
  }

  async function restoreState(archiveFile: File | undefined) {
    if (!archiveFile) return;

    setError(null);

    try {
      const archive = await readGzipJson<AppIconArchive>(archiveFile);
      if (archive.kind !== 'shipkit-appicon.state') {
        setError('Upload a Shipkit app icon state archive.');
        return;
      }

      setSource(archive.source ? {
        dataUrl: `data:${archive.source.type};base64,${archive.source.data}`,
        name: archive.source.name,
        type: archive.source.type
      } : null);
      setSourceOverrides(archive.sourceOverrides ?? {});
      setOptions(normalizeStoredOptions(archive.options));
      setIcons(iconsFromGeneratedArchive(archive.generated));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not restore this archive.');
    }
  }

  function resetState() {
    setSource(null);
    setSourceOverrides({});
    setOptions(defaultOptions);
    setIcons([]);
    setError(null);
    setMainTab('all');
    setDownloadTargetIds(new Set(allTargetIds));
    setIsDownloadDialogOpen(false);
    setCollapsedGroups({});
    localStorage.removeItem(storageKey);
  }

  function clearSource() {
    if ((options.sourceScopeMode ?? 'single') === 'multi') {
      setSourceOverrides((current) => {
        const platformSources = { ...current.platformSources };
        delete platformSources[sourcePlatform];
        return { ...current, platformSources };
      });
    } else {
      setSource(null);
      setSourceOverrides({});
    }
    setIcons([]);
    setError(null);
  }

  function setScopeMode(kind: PanelKind, mode: IconStyleScopeMode) {
    setOptions((current) => ({
      ...current,
      [scopeModeKey(kind)]: mode
    }));
  }

  function setSourceScopeMode(mode: IconStyleScopeMode) {
    setOptions((current) => ({
      ...current,
      sourceScopeMode: mode
    }));
  }

  function updatePanelStyle(
    kind: PanelKind,
    platform: IconStylePlatform,
    key: keyof IconStyleOptions,
    value: IconStyleOptions[keyof IconStyleOptions]
  ) {
    setOptions((current) => {
      const mode = current[scopeModeKey(kind)] ?? 'single';
      if (mode === 'single') return { ...current, [key]: value };

      return {
        ...current,
        platformStyles: {
          ...current.platformStyles,
          [platform]: {
            ...current.platformStyles?.[platform],
            [key]: value
          }
        }
      };
    });
  }

  function toggleAllGroups(collapsed: boolean) {
    setCollapsedGroups(Object.fromEntries(groupOrder.map((group) => [group, collapsed])));
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((current) => ({ ...current, [group]: !current[group] }));
  }

  function setDownloadTargets(targets: IconTarget[], checked: boolean) {
    setDownloadTargetIds((current) => {
      const next = new Set(current);
      for (const target of targets) {
        if (checked) next.add(target.id);
        else next.delete(target.id);
      }
      return next;
    });
  }

  async function openIconPreview(target: IconTarget, generatedIcon: GeneratedIcon | null) {
    const style = styleForTarget(options, target.id, target.platform, target.stylePlatform);
    const targetSource = sourceForTargetSnapshot(source, sourceOverrides, target.id, target.platform, target.stylePlatform);
    const existingIcon = generatedIcon ?? icons.find((icon) => icon.id === target.id) ?? null;

    if (!targetSource) {
      setPreviewSelection({ dataUrl: existingIcon?.dataUrl ?? null, source: null, style, target });
      return;
    }

    try {
      const previewScale = previewDialogRenderScale(target.size);
      setPreviewSelection({
        dataUrl: await renderIcon(
          targetSource.dataUrl,
          Math.max(target.size, Math.ceil(target.size * previewScale)),
          scaleRenderStyle(style, previewScale),
          target.platform
        ),
        source: targetSource,
        style,
        target
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not render this preview.');
    }
  }

  function previewKeyAction(event: KeyboardEvent, target: IconTarget, icon: GeneratedIcon | null) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void openIconPreview(target, icon);
  }

  return (
    <main className='shell'>
      <header className='topbar'>
        <div className='topbar-identity'>
          <div className='product-mark'>
            <strong>
              <a href={shipkitUrl} rel='noreferrer' target='_blank'>Shipkit</a>
              AppIcon
            </strong>
          </div>
          <span className='project-pill'><i /> Generator</span>
        </div>
        <div className='topbar-actions'>
          {showShipkitPromo && (
            <a className='shipkit-promo' href={shipkitUrl} rel='noreferrer' target='_blank'>
              <strong>Shipkit CLI</strong>
              <span>Automate Expo icons, builds, and releases with one focused CLI.</span>
            </a>
          )}
          <button
            className='download-button has-tooltip'
            data-tooltip='Choose icon groups, generate them, and download a tar.gz with iOS, Android, and Android rounded files.'
            disabled={!hasAnySource(source, sourceOverrides) || isGenerating}
            onClick={openDownloadDialog}
          >
            <DownloadIcon />
            Generate & Download
          </button>
          <div className='state-menu' ref={stateMenuRef}>
            <button
              className='ghost-button has-tooltip'
              data-tooltip='Start a fresh icon setup and clear the current artwork and settings.'
              onClick={resetState}
            >
              <PlusIcon />New
            </button>
            <div className='state-actions'>
              <button
                aria-expanded={isStateMenuOpen}
                aria-label='Secondary Actions'
                className='state-toggle'
                type='button'
                onClick={() => setIsStateMenuOpen((open) => !open)}
              >
                <ChevronDownIcon />
              </button>
              {isStateMenuOpen && (
                <div className='state-popover'>
                <button onClick={() => void downloadArchive('state')}>
                  <DownloadIcon />
                  <strong>Backup State</strong>
                  <span>Save your current icon artwork and settings to an archived file.</span>
                </button>
                <label>
                  <UploadIcon />
                  <strong>Restore State</strong>
                  <span>Restore icon editing from a backed-up archive file.</span>
                  <input
                    accept='.gz,application/gzip'
                    type='file'
                    onChange={(event) => void restoreState(event.target.files?.[0])}
                  />
                </label>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <aside className='controls'>
        <ControlBlock
          action={(
            <div className='source-actions'>
              {!sourceHeaderGraphic && <code className='no-asset-badge'>no asset</code>}
              {sourceHeaderGraphic && (
                <button
                  aria-label='Clear icon graphic'
                  className='clear-action'
                  onClick={clearSource}
                  type='button'
                >
                  <XMarkIcon />
                  <span>Clear</span>
                </button>
              )}
              <PanelScope mode={options.sourceScopeMode ?? 'single'} onChange={setSourceScopeMode} />
            </div>
          )}
          eyebrow='Icon graphic'
          meta='No asset'
        >
          {(options.sourceScopeMode ?? 'single') === 'multi' && (
            <PlatformTabs active={sourcePlatform} onChange={setSourcePlatform} />
          )}
          <SourceAssetCard
            mode={options.sourceScopeMode ?? 'single'}
            platform={sourcePlatform}
            source={source}
            sourceOverrides={sourceOverrides}
            onChoose={chooseFile}
          />
        </ControlBlock>

        <ShapePanel
          mode={options.shapeScopeMode ?? 'single'}
          onModeChange={(mode) => setScopeMode('shape', mode)}
          onPlatformChange={setShapePlatform}
          onUpdate={(platform, key, value) => updatePanelStyle('shape', platform, key, value)}
          platform={shapePlatform}
          style={panelStyle(options, 'shape', shapePlatform)}
        />

        <BackgroundPanel
          mode={options.backgroundScopeMode ?? 'single'}
          onModeChange={(mode) => setScopeMode('background', mode)}
          onPlatformChange={setBackgroundPlatform}
          onUpdate={(platform, key, value) => updatePanelStyle('background', platform, key, value)}
          platform={backgroundPlatform}
          style={panelStyle(options, 'background', backgroundPlatform)}
        />

        <BorderPanel
          mode={options.borderScopeMode ?? 'single'}
          onModeChange={(mode) => setScopeMode('border', mode)}
          onPlatformChange={setBorderPlatform}
          onUpdate={(platform, key, value) => updatePanelStyle('border', platform, key, value)}
          platform={borderPlatform}
          style={panelStyle(options, 'border', borderPlatform)}
        />
      </aside>

      <section className='workspace'>
        <div className='content-toolbar'>
          <Segmented
            active={mainTab}
            className='main-tabs'
            options={[
              ['all', <TabLabel icon={<GridTabIcon />} text='All' />],
              ['ios', <TabLabel icon={<AppleTabIcon />} text='iOS' />],
              ['android', <TabLabel icon={<AndroidTabIcon />} text='Android' />],
              ['preview', <TabLabel icon={<PreviewPhoneTabIcon />} text='Preview' />]
            ]}
            onChange={setMainTab}
          />
          <div className='collapse-actions'>
            <div className='icon-button-group'>
              <button
                aria-label='Expand all groups'
                className='has-tooltip'
                data-tooltip='Expand all groups'
                onClick={() => toggleAllGroups(false)}
              >
                <DoubleChevronDownIcon />
                <span>Expand</span>
              </button>
              <button
                aria-label='Collapse all groups'
                className='has-tooltip'
                data-tooltip='Collapse all groups'
                onClick={() => toggleAllGroups(true)}
              >
                <DoubleChevronUpIcon />
                <span>Collapse</span>
              </button>
            </div>
          </div>
        </div>

        <div className='workspace-content'>
        {error && <p className='error'>{error}</p>}

        {mainTab === 'preview' ? (
          <PreviewStage
            android={{
              dataUrl: androidPreviewDataUrl,
              isRendering: Boolean(androidPreviewSource && !androidPreviewDataUrl),
              source: androidPreviewSource,
              style: androidPreviewStyle,
              target: androidPreviewTarget
            }}
            androidRounded={{
              dataUrl: androidRoundedPreviewDataUrl,
              isRendering: Boolean(androidRoundedPreviewSource && !androidRoundedPreviewDataUrl),
              source: androidRoundedPreviewSource,
              style: androidRoundedPreviewStyle,
              target: androidRoundedPreviewTarget
            }}
            ios={{
              dataUrl: iosPreviewDataUrl,
              isRendering: Boolean(iosPreviewSource && !iosPreviewDataUrl),
              source: iosPreviewSource,
              style: iosPreviewStyle,
              target: iosPreviewTarget
            }}
            preferredAndroidVariant={shapePlatform === 'androidRounded' ? 'rounded' : 'default'}
          />
        ) : (
          <div className='results'>
            {Object.entries(groupedIcons).map(([group, groupIcons]) => {
              const isCollapsed = collapsedGroups[group] ?? false;
              return (
                <section className={isCollapsed ? 'catalog-section collapsed' : 'catalog-section'} key={group}>
                  <button className='catalog-head' onClick={() => toggleGroup(group)}>
                    <span className='catalog-title'>
                      <span className='group-collapse-icon'><ChevronDownIcon /></span>
                      <i />
                      <strong>{group}</strong>
                      <em>{groupIcons.length}</em>
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className='asset-grid'>
                      {groupIcons.map((target) => {
                        const icon = icons.find((item) => item.id === target.id) ?? null;
                        const previewIcon = displayIcons.find((item) => item.id === target.id) ?? null;
                        return (
                          <article
                            className='asset-well'
                            key={target.id}
                            role='button'
                            tabIndex={0}
                            onClick={() => void openIconPreview(target, icon)}
                            onKeyDown={(event) => previewKeyAction(event, target, icon)}
                          >
                            <div className='well-preview'>
                              {previewIcon?.dataUrl
                                ? (
                                  <img
                                    alt=''
                                    src={previewIcon.dataUrl}
                                    style={previewImageStyle(target, catalogPreviewCssSize)}
                                  />
                                )
                                : <span className='well-preview-empty'>ϟ</span>}
                            </div>
                            <h3>{target.name}</h3>
                            <p>{target.size} x {target.size}</p>
                            {icon && (
                              <a
                                download={target.fileName.split('/').at(-1)}
                                href={icon.dataUrl}
                                onClick={(event) => event.stopPropagation()}
                              >
                                PNG
                              </a>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        </div>
      </section>
      {previewSelection && (
        <IconPreviewDialog
          preview={previewSelection}
          onClose={() => setPreviewSelection(null)}
        />
      )}
      {isDownloadDialogOpen && (
        <DownloadSelectionDialog
          groups={groupedDownloadTargets}
          isGenerating={isGenerating}
          selectedCount={downloadSelectedCount}
          selectedIds={downloadTargetIds}
          totalCount={downloadTargets.length}
          onClose={() => setIsDownloadDialogOpen(false)}
          onDownload={async () => {
            await downloadArchive('generated', downloadTargetIds);
            setIsDownloadDialogOpen(false);
          }}
          onToggleGroup={setDownloadTargets}
        />
      )}
    </main>
  );
}

function ControlBlock(props: {
  action?: React.ReactNode;
  children: React.ReactNode;
  eyebrow: string;
  meta?: string;
}) {
  return (
    <section className='control-block'>
      <div className='control-title'>
        <span>{props.eyebrow}</span>
        {props.action ?? <code>{props.meta}</code>}
      </div>
      {props.children}
    </section>
  );
}

function SourceAssetCard(props: {
  mode: IconStyleScopeMode;
  onChoose: (file: File | undefined) => Promise<void>;
  platform: IconStylePlatform;
  source: SourceSnapshot | null;
  sourceOverrides: IconSourceOverrides;
}) {
  const currentSource = props.mode === 'multi'
    ? sourceForStylePlatformSnapshot(props.source, props.sourceOverrides, props.platform)
    : props.source;
  return (
    <label className={currentSource ? 'asset-card has-source' : 'asset-card empty'}>
      <input
        accept='image/png,image/jpeg,image/webp,image/svg+xml'
        type='file'
        onChange={(event) => void props.onChoose(event.target.files?.[0])}
      />
      <span className='asset-preview'>
        {currentSource ? <img alt='' src={currentSource.dataUrl} /> : <b>ϟ</b>}
      </span>
      <span>
        <strong>{currentSource?.name ?? sourceLabel(props.platform, props.mode)}</strong>
        <small>{currentSource ? 'Source selected' : 'PNG, JPEG, WebP, or SVG'}</small>
        <em>{currentSource ? 'Replace Asset' : 'Choose Asset'}</em>
      </span>
    </label>
  );
}

function ShapePanel(props: {
  mode: IconStyleScopeMode;
  onModeChange: (mode: IconStyleScopeMode) => void;
  onPlatformChange: (platform: IconStylePlatform) => void;
  onUpdate: (platform: IconStylePlatform, key: keyof IconStyleOptions, value: IconStyleOptions[keyof IconStyleOptions]) => void;
  platform: IconStylePlatform;
  style: IconStyleOptions;
}) {
  const isRoundedAndroid = props.platform === 'androidRounded';
  const availableShapes = isRoundedAndroid
    ? (['circle', 'original'] satisfies IconShape[])
    : (['square', 'squircle', 'organic', 'circle', 'original'] satisfies IconShape[]);
  const activeShape = isRoundedAndroid && props.style.shape !== 'circle' && props.style.shape !== 'original'
    ? 'circle'
    : props.style.shape;
  const presets = isRoundedAndroid ? [] : shapePresetGroups[activeShape] ?? [];

  function applyPreset(preset: ShapePreset) {
    props.onUpdate(props.platform, 'borderRadius', preset.borderRadius);
    props.onUpdate(props.platform, 'shape', props.style.shape);
    if (preset.shadow !== undefined) {
      props.onUpdate(props.platform, 'shadow', preset.shadow);
    }
  }

  return (
    <ControlBlock
      action={<PanelScope mode={props.mode} onChange={props.onModeChange} />}
      eyebrow='Shape'
    >
      {props.mode === 'multi' && (
        <PlatformTabs active={props.platform} onChange={props.onPlatformChange} />
      )}
      <div className='shape-grid'>
        {availableShapes.map((shape) => (
          <button
            className={activeShape === shape ? 'shape-button active' : 'shape-button'}
            key={shape}
            onClick={() => props.onUpdate(props.platform, 'shape', shape)}
          >
            <span className={`shape-frame ${shape}`}>
              <i className={`shape-icon ${shape}`} />
              {props.style.shape === shape && <b className='shape-bolt'>ϟ</b>}
            </span>
            <span>{shapeLabel(shape)}</span>
          </button>
        ))}
      </div>
      <div className='shape-fit-controls'>
        <Range
          label='Scale'
          max={150}
          min={25}
          suffix='%'
          value={props.style.scale}
          onChange={(scale) => props.onUpdate(props.platform, 'scale', scale)}
        />
        <Range
          label='Padding'
          max={50}
          min={0}
          suffix='%'
          value={props.style.padding}
          onChange={(padding) => props.onUpdate(props.platform, 'padding', padding)}
        />
      </div>
      {activeShape === 'square' && (
        <div className='shape-detail-controls'>
          <Range
            label='Corner Radius'
            max={40}
            min={0}
            suffix='%'
            value={props.style.borderRadius}
            onChange={(borderRadius) => props.onUpdate(props.platform, 'borderRadius', borderRadius)}
          />
        </div>
      )}
      {activeShape === 'organic' && (
        <div className='shape-detail-controls'>
          <Range
            label='Primary Radius'
            max={50}
            min={0}
            suffix='%'
            value={props.style.borderRadius}
            onChange={(borderRadius) => props.onUpdate(props.platform, 'borderRadius', borderRadius)}
          />
          <Range
            label='Secondary Radius'
            max={50}
            min={0}
            suffix='%'
            value={props.style.shadow}
            onChange={(shadow) => props.onUpdate(props.platform, 'shadow', shadow)}
          />
        </div>
      )}
      {activeShape === 'squircle' && (
        <div className='shape-detail-controls'>
          <Range
            label='Corner Size'
            max={squircleCornerMax}
            min={0}
            suffix='%'
            value={Math.min(props.style.borderRadius, squircleCornerMax)}
            onChange={(borderRadius) => props.onUpdate(props.platform, 'borderRadius', borderRadius)}
          />
          <Range
            label='Curve Tension'
            max={40}
            min={0}
            value={props.style.shadow}
            onChange={(shadow) => props.onUpdate(props.platform, 'shadow', shadow)}
          />
        </div>
      )}
      {presets.length > 0 && (
        <div className='preset-row shape-preset-row'>
          {presets.map((preset) => (
            <button
              key={`${props.style.shape}-${preset.label}`}
              type='button'
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </ControlBlock>
  );
}

function BackgroundPanel(props: {
  mode: IconStyleScopeMode;
  onModeChange: (mode: IconStyleScopeMode) => void;
  onPlatformChange: (platform: IconStylePlatform) => void;
  onUpdate: (platform: IconStylePlatform, key: keyof IconStyleOptions, value: IconStyleOptions[keyof IconStyleOptions]) => void;
  platform: IconStylePlatform;
  style: IconStyleOptions;
}) {
  return (
    <ControlBlock
      action={<PanelScope mode={props.mode} onChange={props.onModeChange} />}
      eyebrow='Background fill'
    >
      {props.mode === 'multi' && (
        <PlatformTabs active={props.platform} onChange={props.onPlatformChange} />
      )}
      <Segmented
        active={props.style.backgroundMode}
        options={[
          ['solid', 'Solid'],
          ['gradient', 'Gradient'],
          ['none', 'None']
        ]}
        onChange={(mode) => props.onUpdate(props.platform, 'backgroundMode', mode)}
      />
      {props.style.backgroundMode !== 'none' && (
        <>
          <ColorRow
            color={props.style.background}
            label='Primary'
            onChange={(color) => props.onUpdate(props.platform, 'background', color)}
          />
          {props.style.backgroundMode === 'gradient' && (
            <>
              <ColorRow
                color={props.style.backgroundEnd}
                label='Secondary'
                onChange={(color) => props.onUpdate(props.platform, 'backgroundEnd', color)}
              />
              <Range
                label='Angle'
                max={360}
                min={0}
                suffix='°'
                value={props.style.backgroundAngle}
                onChange={(angle) => props.onUpdate(props.platform, 'backgroundAngle', angle)}
              />
            </>
          )}
          <div className='palette-row'>
            {backgroundPalette.map(([start, end]) => (
              <button
                aria-label={`Use ${start}${props.style.backgroundMode === 'gradient' ? ` to ${end}` : ''}`}
                key={`background-${start}-${end}`}
                style={{ background: props.style.backgroundMode === 'gradient' ? `linear-gradient(${props.style.backgroundAngle}deg, ${start}, ${end})` : start }}
                onClick={() => {
                  props.onUpdate(props.platform, 'background', start);
                  props.onUpdate(props.platform, 'backgroundEnd', end);
                }}
              />
            ))}
          </div>
        </>
      )}
    </ControlBlock>
  );
}

function BorderPanel(props: {
  mode: IconStyleScopeMode;
  onModeChange: (mode: IconStyleScopeMode) => void;
  onPlatformChange: (platform: IconStylePlatform) => void;
  onUpdate: (platform: IconStylePlatform, key: keyof IconStyleOptions, value: IconStyleOptions[keyof IconStyleOptions]) => void;
  platform: IconStylePlatform;
  style: IconStyleOptions;
}) {
  return (
    <ControlBlock
      action={<PanelScope mode={props.mode} onChange={props.onModeChange} />}
      eyebrow='Border'
    >
      {props.mode === 'multi' && (
        <PlatformTabs active={props.platform} onChange={props.onPlatformChange} />
      )}
      <Segmented
        active={props.style.borderMode}
        options={[
          ['solid', 'Solid'],
          ['gradient', 'Gradient'],
          ['none', 'None']
        ]}
        onChange={(mode) => props.onUpdate(props.platform, 'borderMode', mode)}
      />
      {props.style.borderMode !== 'none' && (
        <>
          <ColorRow
            color={props.style.borderColor}
            label='Primary'
            onChange={(color) => props.onUpdate(props.platform, 'borderColor', color)}
          />
          {props.style.borderMode === 'gradient' && (
            <>
              <ColorRow
                color={props.style.borderEnd}
                label='Secondary'
                onChange={(color) => props.onUpdate(props.platform, 'borderEnd', color)}
              />
              <Range
                label='Angle'
                max={360}
                min={0}
                suffix='°'
                value={props.style.borderAngle}
                onChange={(angle) => props.onUpdate(props.platform, 'borderAngle', angle)}
              />
            </>
          )}
          <Range
            label='Border Size'
            max={20}
            min={1}
            suffix='px'
            value={props.style.borderSize}
            onChange={(borderSize) => props.onUpdate(props.platform, 'borderSize', borderSize)}
          />
          <div className='palette-row border-palette'>
            {borderPalette.map(([start, end]) => (
              <button
                aria-label={`Use border ${start}${props.style.borderMode === 'gradient' ? ` to ${end}` : ''}`}
                key={`border-${start}-${end}`}
                style={{ background: props.style.borderMode === 'gradient' ? `linear-gradient(${props.style.borderAngle}deg, ${start}, ${end})` : start }}
                onClick={() => {
                  props.onUpdate(props.platform, 'borderColor', start);
                  props.onUpdate(props.platform, 'borderEnd', end);
                }}
              />
            ))}
          </div>
        </>
      )}
    </ControlBlock>
  );
}

function PanelScope(props: {
  mode: IconStyleScopeMode;
  onChange: (mode: IconStyleScopeMode) => void;
}) {
  return (
    <div className='segmented scope-mode'>
      <button
        aria-label='Single style mode'
        className={props.mode === 'single' ? 'active has-tooltip' : 'has-tooltip'}
        data-tooltip='Single'
        onClick={() => props.onChange('single')}
      >
        <SingleModeIcon />
      </button>
      <button
        aria-label='Multi style mode'
        className={props.mode === 'multi' ? 'active has-tooltip' : 'has-tooltip'}
        data-tooltip='Multi'
        onClick={() => props.onChange('multi')}
      >
        <MultiModeIcon />
      </button>
    </div>
  );
}

function PlatformTabs(props: {
  active: IconStylePlatform;
  onChange: (platform: IconStylePlatform) => void;
}) {
  return (
    <Segmented
      active={props.active}
      className='platform-mini-tabs'
      options={[
        ['ios', 'iOS'],
        ['android', 'Android'],
        ['androidRounded', 'Rounded']
      ]}
      onChange={props.onChange}
    />
  );
}

function TabLabel(props: { icon: ReactNode; text: string; }) {
  return (
    <span className='tab-label'>
      {props.icon}
      <span>{props.text}</span>
    </span>
  );
}

function Segmented<T extends string>(props: {
  active: T;
  className?: string;
  onChange: (value: T) => void;
  options: [T, ReactNode][];
}) {
  return (
    <div className={props.className ? `segmented ${props.className}` : 'segmented'}>
      {props.options.map(([value, label]) => (
        <button
          className={props.active === value ? 'active' : ''}
          key={value}
          onClick={() => props.onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ColorRow(props: {
  color: string;
  label: string;
  onChange: (color: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className={isOpen ? 'color-row open' : 'color-row'} ref={rootRef}>
      <div className='color-trigger'>
        <button
          aria-expanded={isOpen}
          className='color-trigger-main'
          type='button'
          onClick={() => setIsOpen((open) => !open)}
        >
          <span className='color-label'>{props.label}</span>
          <span className='color-code-box'>
            <i style={{ background: props.color }} />
            <code>{props.color}</code>
          </span>
        </button>
      </div>
      {isOpen && (
        <div className='color-popover'>
          <HexColorPicker color={props.color} onChange={props.onChange} />
          <div className='color-popover-footer'>
            <label className='hex-field'>
              <span style={{ background: props.color }} />
              <HexColorInput className='hex-chip' color={props.color} prefixed onChange={props.onChange} />
            </label>
            <button
              aria-label='Collapse color picker'
              className='color-close'
              type='button'
              onClick={() => setIsOpen(false)}
            >
              <ChevronDownIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Range(props: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix?: string;
  value: number;
}) {
  const [draft, setDraft] = useState(String(props.value));

  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);

  function commitDraft() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(props.value));
      return;
    }

    const nextValue = clamp(Math.round(parsed), props.min, props.max);
    setDraft(String(nextValue));
    props.onChange(nextValue);
  }

  function updateDraft(value: string) {
    setDraft(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= props.min && parsed <= props.max) {
      props.onChange(Math.round(parsed));
    }
  }

  return (
    <label className='range'>
      <span>{props.label}</span>
      <span className='range-control'>
        <input
          max={props.max}
          min={props.min}
          type='range'
          value={props.value}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
        <span className='range-input'>
          <input
            inputMode='numeric'
            max={props.max}
            min={props.min}
            type='number'
            value={draft}
            onBlur={commitDraft}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          {props.suffix && <span className='range-input-suffix'>{props.suffix}</span>}
        </span>
      </span>
    </label>
  );
}

function IconPreviewDialog(props: {
  onClose: () => void;
  preview: PreviewSelection;
}) {
  const { preview } = props;
  const displaySize = previewDialogDisplaySize(preview.target.size);
  const imageStyle = {
    '--preview-display-size': `${displaySize}px`,
    '--preview-size': `${preview.target.size}px`
  } as CSSProperties;
  const filename = preview.target.fileName.split('/').at(-1) ?? preview.target.fileName;
  return (
    <div
      aria-modal='true'
      className='preview-dialog-backdrop'
      role='dialog'
      onClick={props.onClose}
    >
      <section className='preview-dialog' onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <strong>{preview.target.name}</strong>
            <em>{preview.target.group}</em>
          </span>
          <code>{preview.target.size}px export</code>
          <button className='preview-close-button' aria-label='Close preview' onClick={props.onClose}>
            <XMarkIcon />
          </button>
        </header>
        <div className='preview-dialog-artboard'>
          {preview.dataUrl ? (
            <img
              alt=''
              height={preview.target.size}
              src={preview.dataUrl}
              style={imageStyle}
              width={preview.target.size}
            />
          ) : (
            <span className='preview-dialog-empty'>Select a source image to render this target.</span>
          )}
          {preview.dataUrl && <span className='preview-zoom-chip'>actual size</span>}
        </div>
        <footer className='preview-dialog-meta'>
          <span>
            <em>Size</em>
            <strong>{preview.target.size} x {preview.target.size}</strong>
          </span>
          <span>
            <em>Platform</em>
            <strong>{previewPlatformLabel(preview.target)}</strong>
          </span>
          <span className='preview-dialog-path'>
            <em>File</em>
            <strong>{filename}</strong>
            <code>{preview.target.fileName}</code>
          </span>
        </footer>
      </section>
    </div>
  );
}

function DownloadSelectionDialog(props: {
  groups: Record<string, IconTarget[]>;
  isGenerating: boolean;
  onClose: () => void;
  onDownload: () => Promise<void>;
  onToggleGroup: (targets: IconTarget[], checked: boolean) => void;
  selectedCount: number;
  selectedIds: Set<string>;
  totalCount: number;
}) {
  const groups = Object.entries(props.groups);

  return (
    <div
      aria-modal='true'
      className='download-dialog-backdrop'
      role='dialog'
      onClick={props.onClose}
    >
      <section className='download-dialog' onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <em>Export package</em>
            <strong>Choose icon groups to generate</strong>
          </span>
          <code>{props.selectedCount} / {props.totalCount} assets</code>
          <button className='preview-close-button' aria-label='Close download options' onClick={props.onClose}>
            <XMarkIcon />
          </button>
        </header>

        <div className='download-dialog-hero'>
          <span><DownloadIcon /></span>
          <p>Package production-ready iOS, Android legacy, rounded, and adaptive icon assets into a structured tar.gz archive.</p>
        </div>

        <div className='download-group-grid'>
          {groups.map(([group, targets]) => {
            const selectedInGroup = targets.filter((target) => props.selectedIds.has(target.id)).length;
            const isChecked = selectedInGroup === targets.length;
            const isPartial = selectedInGroup > 0 && selectedInGroup < targets.length;

            return (
              <label className={isChecked || isPartial ? 'download-group-card selected' : 'download-group-card'} key={group}>
                <input
                  checked={isChecked}
                  type='checkbox'
                  onChange={(event) => props.onToggleGroup(targets, event.target.checked)}
                />
                <span className='download-check' aria-hidden='true'>
                  {isChecked ? <CheckIcon /> : isPartial ? <MinusIcon /> : null}
                </span>
                <span className='download-group-copy'>
                  <strong>
                    {group}
                    <em>{targets.length} assets</em>
                  </strong>
                </span>
                <span className='download-group-sizes'>
                  {targets.slice(0, 4).map((target) => <i key={target.id}>{target.size}px</i>)}
                  {targets.length > 4 && <i>+{targets.length - 4}</i>}
                </span>
              </label>
            );
          })}
        </div>

        <footer>
          <button className='ghost-button' type='button' onClick={props.onClose}>
            Cancel
          </button>
          <button
            className='download-button'
            disabled={props.selectedCount === 0 || props.isGenerating}
            type='button'
            onClick={() => void props.onDownload()}
          >
            <DownloadIcon />
            {props.isGenerating ? 'Rendering...' : `Download ${props.selectedCount} assets`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function previewDialogDisplaySize(size: number) {
  return size;
}

function previewDialogRenderScale(size: number) {
  const dpr = Math.min(maxPreviewDpr, Math.max(1, window.devicePixelRatio || 1));
  const maxRenderSize = 2048;
  return Math.max(1, Math.min(dpr, maxRenderSize / size));
}

function scaleRenderStyle(options: IconStyleOptions, scale: number): IconStyleOptions {
  if (scale === 1) return options;
  return {
    ...options,
    borderSize: options.borderSize * scale
  };
}

type PlatformPreview = {
  dataUrl: string | null;
  isRendering: boolean;
  source: SourceSnapshot | null;
  style: IconStyleOptions;
  target: IconTarget;
};

function PreviewStage(props: {
  android: PlatformPreview;
  androidRounded: PlatformPreview;
  ios: PlatformPreview;
  preferredAndroidVariant: AndroidPreviewVariant;
}) {
  const [androidVariant, setAndroidVariant] = useState<AndroidPreviewVariant>(props.preferredAndroidVariant);
  const androidPreview = androidVariant === 'rounded' ? props.androidRounded : props.android;

  useEffect(() => {
    setAndroidVariant(props.preferredAndroidVariant);
  }, [props.preferredAndroidVariant]);

  return (
    <section className='preview-stage'>
      <PhonePreview kind='ios' preview={props.ios} />
      <PhonePreview
        action={(
          <Segmented
            active={androidVariant}
            className='phone-variant-toggle'
            options={[
              ['default', 'Default'],
              ['rounded', 'Rounded']
            ]}
            onChange={setAndroidVariant}
          />
        )}
        kind={androidVariant === 'rounded' ? 'android-rounded' : 'android'}
        preview={androidPreview}
      />
    </section>
  );
}

function PhonePreview(props: { action?: ReactNode; kind: IconPlatform | 'android-rounded'; preview: PlatformPreview; }) {
  const title = props.kind === 'ios'
    ? 'iOS Preview'
    : props.kind === 'android-rounded'
    ? 'Android Rounded'
    : 'Android Preview';
  const detail = props.kind === 'ios'
    ? 'Home Screen and App Store icon'
    : props.kind === 'android-rounded'
    ? 'Round launcher icon context'
    : 'Launcher and adaptive foreground context';
  const filename = props.preview.target.fileName.split('/').at(-1) ?? props.preview.target.fileName;

  return (
    <article className={`phone ${props.kind}`}>
      <header className='phone-card-head'>
        <span>
          <strong>{title}</strong>
          <em>{detail}</em>
        </span>
        {props.action ?? <code>{props.preview.target.size}px</code>}
      </header>
      <div className='phone-screen'>
        <div className='phone-status'>
          <span>10:08</span>
          <i />
        </div>
        <div className='phone-wallpaper' />
        <div className='phone-grid'>
          <span className='mock-app cool' />
          <span className='mock-app warm' />
          <span className='mock-app mint' />
          <span className='mock-app sky' />
          <span className='mock-app dim' />
          <span className='mock-app rose' />
          <span className='preview-app'>
            <PreviewIcon preview={props.preview} />
            <small>Shipkit</small>
          </span>
          <span className='mock-app violet' />
        </div>
        <div className='phone-dock'>
          <span />
          <span />
          <span />
        </div>
      </div>
      <footer className='phone-context'>
        <span>
          <PreviewIcon preview={props.preview} />
        </span>
        <p>
          <strong>{props.preview.target.name}</strong>
          <em>{filename}</em>
        </p>
      </footer>
    </article>
  );
}

function PreviewIcon(props: { preview: PlatformPreview; }) {
  if (props.preview.dataUrl) {
    return <img alt='' className='preview-rendered-icon' src={props.preview.dataUrl} />;
  }

  if (props.preview.source || props.preview.isRendering) {
    return <span className='preview-rendering-icon' />;
  }

  return <span className='preview-empty-icon'>ϟ</span>;
}

function IconSample(props: {
  platform?: IconPlatform;
  size?: number;
  source: SourceSnapshot | null;
  style: IconStyleOptions;
}) {
  const background = props.style.backgroundMode === 'none'
    ? 'transparent'
    : props.style.backgroundMode === 'gradient'
    ? `linear-gradient(${props.style.backgroundAngle}deg, ${props.style.background}, ${props.style.backgroundEnd})`
    : props.style.background;
  const radius = props.style.shape === 'circle'
    ? '50%'
    : props.style.shape === 'squircle'
    ? `${squircleCornerPercent(props.style)}%`
    : props.style.shape === 'organic'
    ? `${props.style.borderRadius}% ${props.style.shadow}% ${props.style.borderRadius}% ${props.style.shadow}%`
    : props.style.shape === 'square'
    ? `${props.style.borderRadius}%`
    : '0';
  const contentInset = Math.min(49, Math.max(0, props.style.padding));
  const assetSize = Math.max(1, props.style.scale);
  const sampleStyle = {
    '--asset-scale': String(assetSize / 100),
    '--asset-size': `${assetSize}%`,
    '--sample-content-inset': `${contentInset}%`,
    background,
    borderRadius: radius,
    ...(props.size ? { height: props.size, width: props.size } : {})
  } as CSSProperties;

  return (
    <span className={`sample-icon ${props.style.shape}`} style={sampleStyle}>
      <span className='sample-icon-content'>
        {props.source ? <img alt='' src={props.source.dataUrl} /> : <b>ϟ</b>}
      </span>
      <IconBorderOverlay style={props.style} />
    </span>
  );
}

function IconBorderOverlay(props: { style: IconStyleOptions; }) {
  if (props.style.borderMode === 'none' || props.style.borderSize <= 0) return null;

  const vector = gradientVector(props.style.borderAngle);
  const gradientId = `border-gradient-${gradientToken(props.style.borderColor)}-${gradientToken(props.style.borderEnd)}-${props.style.borderAngle}`;
  const fill = props.style.borderMode === 'gradient' ? `url(#${gradientId})` : props.style.borderColor;
  const path = svgBorderPath(props.style);

  return (
    <svg aria-hidden='true' className='sample-border-overlay' viewBox='0 0 64 64'>
      {props.style.borderMode === 'gradient' && (
        <defs>
          <linearGradient
            gradientUnits='userSpaceOnUse'
            id={gradientId}
            x1={vector.x1}
            x2={vector.x2}
            y1={vector.y1}
            y2={vector.y2}
          >
            <stop stopColor={props.style.borderColor} />
            <stop offset='1' stopColor={props.style.borderEnd} />
          </linearGradient>
        </defs>
      )}
      <path
        d={path}
        fill={fill}
        fillRule='evenodd'
      />
    </svg>
  );
}

function gradientToken(value: string) {
  return value.replace(/[^a-z0-9]/giu, '');
}

function gradientVector(angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  const dx = Math.cos(radians) * 32;
  const dy = Math.sin(radians) * 32;
  return {
    x1: 32 - dx,
    x2: 32 + dx,
    y1: 32 - dy,
    y2: 32 + dy
  };
}

function svgBorderPath(options: IconStyleOptions) {
  const inset = Math.max(0.5, Math.min(31.5, options.borderSize));
  return `${svgShapePathAt(0, 0, 64, 64, options)} ${svgShapePathAt(inset, inset, 64 - inset * 2, 64 - inset * 2, options)}`;
}

function svgShapePathAt(x: number, y: number, width: number, height: number, options: IconStyleOptions) {
  if (options.shape === 'circle') {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const radius = Math.min(width, height) / 2;
    return `M ${centerX} ${centerY - radius} a ${radius} ${radius} 0 1 1 0 ${radius * 2} a ${radius} ${radius} 0 1 1 0 -${radius * 2}`;
  }

  if (options.shape === 'squircle') {
    return superellipseSvgPath(x, y, width, height, squircleExponent(options));
  }

  if (options.shape === 'organic') {
    const size = Math.min(width, height);
    return roundedSvgRadiiPath(x, y, width, height, {
      bottomLeft: size * (options.shadow / 100),
      bottomRight: size * (options.borderRadius / 100),
      topLeft: size * (options.borderRadius / 100),
      topRight: size * (options.shadow / 100)
    });
  }

  return roundedSvgRectPath(x, y, width, height, svgShapeRadius(Math.min(width, height), options));
}

function svgShapeRadius(size: number, options: IconStyleOptions) {
  if (options.shape === 'circle') return size / 2;
  if (options.shape === 'squircle') {
    return size * (squircleCornerPercent(options) / 100);
  }
  if (options.shape === 'square') return size * (options.borderRadius / 100);
  return 0;
}

function roundedSvgRectPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `Q ${x} ${y + height} ${x} ${y + height - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z'
  ].join(' ');
}

function roundedSvgRadiiPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: CornerRadii
) {
  const r = normalizeRadii(radius, width, height);
  return [
    `M ${x + r.topLeft} ${y}`,
    `H ${x + width - r.topRight}`,
    `Q ${x + width} ${y} ${x + width} ${y + r.topRight}`,
    `V ${y + height - r.bottomRight}`,
    `Q ${x + width} ${y + height} ${x + width - r.bottomRight} ${y + height}`,
    `H ${x + r.bottomLeft}`,
    `Q ${x} ${y + height} ${x} ${y + height - r.bottomLeft}`,
    `V ${y + r.topLeft}`,
    `Q ${x} ${y} ${x + r.topLeft} ${y}`,
    'Z'
  ].join(' ');
}

function superellipseSvgPath(x: number, y: number, width: number, height: number, exponent: number) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const steps = 80;
  const points: string[] = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const pointX = centerX + Math.sign(cos) * radiusX * Math.abs(cos) ** (2 / exponent);
    const pointY = centerY + Math.sign(sin) * radiusY * Math.abs(sin) ** (2 / exponent);
    points.push(`${index === 0 ? 'M' : 'L'} ${pointX} ${pointY}`);
  }

  return `${points.join(' ')} Z`;
}

function panelStyle(options: IconGenerationOptions, kind: PanelKind, platform: IconStylePlatform) {
  const mode = options[scopeModeKey(kind)] ?? 'single';
  return mode === 'multi'
    ? { ...pickStyle(options), ...options.platformStyles?.[platform] }
    : pickStyle(options);
}

function scopeModeKey(kind: PanelKind) {
  return `${kind}ScopeMode` as const;
}

function styleForTarget(
  options: IconGenerationOptions,
  targetId: string,
  platform: IconPlatform,
  stylePlatform?: IconStylePlatform
): IconStyleOptions {
  const base = pickStyle(options);
  const platformStyle = options.platformStyles?.[stylePlatform ?? platform] ?? {};
  const targetStyle = options.targetStyles?.[targetId] ?? {};
  const next = { ...base, ...targetStyle };

  if ((options.backgroundScopeMode ?? 'single') === 'multi') {
    next.background = platformStyle.background ?? next.background;
    next.backgroundAngle = platformStyle.backgroundAngle ?? next.backgroundAngle;
    next.backgroundEnd = platformStyle.backgroundEnd ?? next.backgroundEnd;
    next.backgroundMode = platformStyle.backgroundMode ?? next.backgroundMode;
  }

  if ((options.shapeScopeMode ?? 'single') === 'multi') {
    next.borderRadius = platformStyle.borderRadius ?? next.borderRadius;
    next.padding = platformStyle.padding ?? next.padding;
    next.scale = platformStyle.scale ?? next.scale;
    next.shadow = platformStyle.shadow ?? next.shadow;
    next.shape = platformStyle.shape ?? next.shape;
  }

  if ((options.borderScopeMode ?? 'single') === 'multi') {
    next.borderAngle = platformStyle.borderAngle ?? next.borderAngle;
    next.borderColor = platformStyle.borderColor ?? next.borderColor;
    next.borderEnd = platformStyle.borderEnd ?? next.borderEnd;
    next.borderMode = platformStyle.borderMode ?? next.borderMode;
    next.borderSize = platformStyle.borderSize ?? next.borderSize;
    next.borderStyle = platformStyle.borderStyle ?? next.borderStyle;
  }

  if (stylePlatform === 'androidRounded' && next.shape !== 'original') {
    next.shape = 'circle';
  }

  return next;
}

function pickStyle(options: IconGenerationOptions): IconStyleOptions {
  return {
    background: options.background,
    backgroundAngle: options.backgroundAngle,
    backgroundEnd: options.backgroundEnd,
    backgroundMode: options.backgroundMode,
    borderAngle: options.borderAngle,
    borderColor: options.borderColor,
    borderEnd: options.borderEnd,
    borderMode: options.borderMode,
    borderRadius: options.borderRadius,
    borderSize: options.borderSize,
    borderStyle: options.borderStyle,
    padding: options.padding,
    scale: options.scale,
    shadow: options.shadow,
    shape: options.shape
  };
}

function sourceForTargetSnapshot(
  source: SourceSnapshot | null,
  overrides: IconSourceOverrides,
  targetId: string,
  platform: IconPlatform,
  stylePlatform?: IconStylePlatform
) {
  const dataUrl = sourceDataUrlForTarget(overrides, targetId, platform, stylePlatform);
  if (dataUrl) return { dataUrl, name: `${stylePlatform ?? platform}-graphic`, type: mimeFromDataUrl(dataUrl) };
  return source;
}

function sourceDataUrlForTarget(
  overrides: IconSourceOverrides,
  targetId: string,
  platform: IconPlatform,
  stylePlatform?: IconStylePlatform
) {
  return overrides.targetSources?.[targetId]
    ?? overrides.platformSources?.[stylePlatform ?? platform]
    ?? (stylePlatform === 'androidRounded' ? overrides.platformSources?.android : undefined);
}

function sourceForStylePlatformSnapshot(
  source: SourceSnapshot | null,
  overrides: IconSourceOverrides,
  platform: IconStylePlatform
) {
  const dataUrl = overrides.platformSources?.[platform]
    ?? (platform === 'androidRounded' ? overrides.platformSources?.android : undefined);
  if (dataUrl) return { dataUrl, name: `${sourceLabel(platform, 'multi')} override`, type: mimeFromDataUrl(dataUrl) };
  return source;
}

function hasAnySource(source: SourceSnapshot | null, overrides: IconSourceOverrides) {
  return Boolean(source || Object.keys(overrides.platformSources ?? {}).length > 0 || Object.keys(overrides.targetSources ?? {}).length > 0);
}

function sourceLabel(platform: IconStylePlatform, mode: IconStyleScopeMode) {
  if (mode === 'single') return 'Drop or browse asset';
  if (platform === 'ios') return 'iOS graphic';
  if (platform === 'androidRounded') return 'Android rounded graphic';
  return 'Android graphic';
}

function previewPlatformLabel(target: IconTarget) {
  if (target.stylePlatform === 'androidRounded') return 'Android rounded';
  return target.platform === 'android' ? 'Android' : 'iOS';
}

function shapeLabel(shape: IconShape) {
  if (shape === 'organic') return 'Asymmetric';
  return shape[0]!.toUpperCase() + shape.slice(1);
}

function makePreviewIcons(options: IconGenerationOptions) {
  return iconTargets.filter((target) => options.platforms.includes(target.platform)).map((target) => ({
    ...target,
    dataUrl: ''
  }));
}

function groupGeneratedIcons<T extends { group: string; }>(items: T[]) {
  const grouped = items.reduce<Record<string, T[]>>((groups, icon) => {
    groups[icon.group] ??= [];
    groups[icon.group]!.push(icon);
    return groups;
  }, {});
  return Object.fromEntries(groupOrder.flatMap((group) => grouped[group] ? [[group, grouped[group]]] : []));
}

async function generateIconsInBrowser(
  source: SourceSnapshot | null,
  options: IconGenerationOptions,
  sourceOverrides: IconSourceOverrides
) {
  const icons: GeneratedIcon[] = [];

  for (const target of iconTargets.filter((item) => options.platforms.includes(item.platform))) {
    const targetSource = sourceForTargetSnapshot(source, sourceOverrides, target.id, target.platform, target.stylePlatform);
    if (!targetSource) throw new Error('Select a source image first.');
    icons.push({
      ...target,
      dataUrl: await renderTargetIcon(
        target,
        targetSource,
        styleForTarget(options, target.id, target.platform, target.stylePlatform)
      )
    });
  }

  return icons;
}

async function generateCatalogPreviewIcons(
  source: SourceSnapshot | null,
  options: IconGenerationOptions,
  sourceOverrides: IconSourceOverrides,
  targets: IconTarget[],
  mainTab: MainTab
) {
  return Promise.all(targets.map(async (target) => {
    const targetSource = sourceForTargetSnapshot(source, sourceOverrides, target.id, target.platform, target.stylePlatform);
    if (!targetSource) throw new Error('Select a source image first.');
    const previewSize = previewRenderSizeForTarget(target, mainTab);
    const previewSource = await previewSourceDataUrl(targetSource.dataUrl, previewSize);

    return {
      ...target,
      dataUrl: await renderIcon(
        previewSource,
        previewSize,
        styleForTarget(options, target.id, target.platform, target.stylePlatform),
        target.platform,
        { preferShapedBackground: true }
      )
    };
  }));
}

async function renderTargetIcon(
  target: IconTarget,
  source: SourceSnapshot,
  options: IconStyleOptions
) {
  return renderIcon(source.dataUrl, target.size, options, target.platform);
}

async function renderIcon(
  dataUrl: string,
  size: number,
  options: IconStyleOptions,
  platform: IconPlatform,
  renderOptions: { preferShapedBackground?: boolean } = {}
) {
  const canvas = document.createElement('canvas');
  canvas.height = size;
  canvas.width = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is not available in this browser.');

  const image = await loadImage(dataUrl);
  void platform;
  void renderOptions;
  const hasOuterShape = options.shape !== 'original';

  context.save();
  if (hasOuterShape) {
    iconShapePath(context, 0, 0, size, size, options);
    context.clip();
  }
  paintBackground(context, size, options);

  const inset = Math.min(
    Math.floor((size - 1) / 2),
    Math.max(0, Math.round(size * (options.padding / 100)))
  );
  const contentSize = Math.max(1, size - inset * 2);
  const scaledContentSize = Math.max(1, Math.round(contentSize * (options.scale / 100)));
  const ratio = Math.min(scaledContentSize / image.naturalWidth, scaledContentSize / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const left = Math.round(inset + (contentSize - width) / 2);
  const top = Math.round(inset + (contentSize - height) / 2);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.save();
  if (inset > 0 || hasOuterShape) {
    iconShapePath(context, inset, inset, contentSize, contentSize, options);
    context.clip();
  }

  if (options.shape !== 'squircle' && options.shape !== 'organic' && options.shadow > 0) {
    context.save();
    context.shadowBlur = Math.max(1, size * (options.shadow / 120));
    context.shadowColor = 'rgba(15, 23, 42, 0.30)';
    context.shadowOffsetY = size * 0.018;
    context.drawImage(image, left, top, width, height);
    context.restore();
  }

  context.drawImage(image, left, top, width, height);
  context.restore();

  paintBorder(context, size, options);
  context.restore();

  return canvas.toDataURL('image/png');
}

function transparentBounds(imageData: ImageData, alphaThreshold = 8) {
  const { data, height, width } = imageData;
  let top = height;
  let right = -1;
  let bottom = -1;
  let left = width;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      if (alpha <= alphaThreshold) continue;

      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) return null;
  return { bottom, left, right, top };
}

function paintBackground(context: CanvasRenderingContext2D, size: number, options: IconStyleOptions) {
  if (options.backgroundMode === 'none') {
    context.clearRect(0, 0, size, size);
    return;
  }

  if (options.backgroundMode === 'solid') {
    context.fillStyle = options.background;
  } else {
    const radians = (options.backgroundAngle - 90) * Math.PI / 180;
    const dx = Math.cos(radians) * size / 2;
    const dy = Math.sin(radians) * size / 2;
    const gradient = context.createLinearGradient(size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy);
    gradient.addColorStop(0, options.background);
    gradient.addColorStop(1, options.backgroundEnd);
    context.fillStyle = gradient;
  }

  context.fillRect(0, 0, size, size);
}

function paintBorder(
  context: CanvasRenderingContext2D,
  size: number,
  options: IconStyleOptions
) {
  if (options.borderMode === 'none' || options.borderSize <= 0) return;

  const borderSize = Math.min((size - 1) / 2, options.borderSize);
  const borderCanvas = document.createElement('canvas');
  borderCanvas.height = size;
  borderCanvas.width = size;
  const borderContext = borderCanvas.getContext('2d');
  if (!borderContext) return;

  borderContext.fillStyle = options.borderMode === 'gradient'
    ? createCanvasGradient(borderContext, size, options.borderColor, options.borderEnd, options.borderAngle)
    : options.borderColor;
  iconShapePath(borderContext, 0, 0, size, size, options);
  borderContext.fill();

  borderContext.globalCompositeOperation = 'destination-out';
  iconShapePath(
    borderContext,
    borderSize,
    borderSize,
    size - borderSize * 2,
    size - borderSize * 2,
    options
  );
  borderContext.fill();

  context.save();
  context.drawImage(borderCanvas, 0, 0);
  context.restore();
}

function createCanvasGradient(
  context: CanvasRenderingContext2D,
  size: number,
  start: string,
  end: string,
  angle: number
) {
  const radians = (angle - 90) * Math.PI / 180;
  const dx = Math.cos(radians) * size / 2;
  const dy = Math.sin(radians) * size / 2;
  const gradient = context.createLinearGradient(size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  return gradient;
}

function iconShapePath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  options: IconStyleOptions
) {
  if (options.shape === 'squircle') {
    squirclePath(context, x, y, width, height, options);
    return;
  }

  if (options.shape === 'organic') {
    organicPath(context, x, y, width, height, options);
    return;
  }

  roundedPath(context, x, y, width, height, shapeRadius(width, height, options));
}

function roundedPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function roundedRadiiPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: CornerRadii
) {
  const radii = normalizeRadii(radius, width, height);
  context.beginPath();
  context.moveTo(x + radii.topLeft, y);
  context.arcTo(x + width, y, x + width, y + height, radii.topRight);
  context.arcTo(x + width, y + height, x, y + height, radii.bottomRight);
  context.arcTo(x, y + height, x, y, radii.bottomLeft);
  context.arcTo(x, y, x + width, y, radii.topLeft);
  context.closePath();
}

function organicPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  options: IconStyleOptions
) {
  const size = Math.min(width, height);
  roundedRadiiPath(context, x, y, width, height, {
    bottomLeft: size * (options.shadow / 100),
    bottomRight: size * (options.borderRadius / 100),
    topLeft: size * (options.borderRadius / 100),
    topRight: size * (options.shadow / 100)
  });
}

function squirclePath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  options: IconStyleOptions
) {
  const exponent = squircleExponent(options);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const steps = 80;

  context.beginPath();
  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const pointX = centerX + Math.sign(cos) * radiusX * Math.abs(cos) ** (2 / exponent);
    const pointY = centerY + Math.sign(sin) * radiusY * Math.abs(sin) ** (2 / exponent);
    if (index === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
}

function shapeRadius(width: number, height: number, options: IconStyleOptions) {
  const size = Math.min(width, height);
  if (options.shape === 'circle') return size / 2;
  if (options.shape === 'square') return size * (options.borderRadius / 100);
  return 0;
}

function normalizeRadii(radius: CornerRadii, width: number, height: number): CornerRadii {
  const maxRadius = Math.min(width / 2, height / 2);
  return {
    bottomLeft: Math.min(radius.bottomLeft, maxRadius),
    bottomRight: Math.min(radius.bottomRight, maxRadius),
    topLeft: Math.min(radius.topLeft, maxRadius),
    topRight: Math.min(radius.topRight, maxRadius)
  };
}

function squircleTension(options: IconStyleOptions) {
  return Math.max(0, Math.min(40, options.shadow));
}

function squircleCornerPercent(options: IconStyleOptions) {
  return Math.max(0, Math.min(squircleCornerMax, options.borderRadius));
}

function squircleExponent(options: IconStyleOptions) {
  const cornerAmount = squircleCornerPercent(options) / squircleCornerMax;
  const tensionAmount = squircleTension(options) / 40;
  const perceptualCorner = 1 - (1 - cornerAmount) ** 2.15;
  const perceptualTension = 1 - (1 - tensionAmount) ** 1.35;
  const squareLikeExponent = 9.25;
  const roundLikeExponent = 3.2;
  const cornerExponent =
    squareLikeExponent - perceptualCorner * (squareLikeExponent - roundLikeExponent);
  const tensionOffset = (0.5 - perceptualTension) * 1.45;

  return Math.max(3.05, Math.min(10, cornerExponent + tensionOffset));
}

function loadImage(dataUrl: string) {
  const cached = imageCache.get(dataUrl);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('error', () => reject(new Error('Could not read the source image.')));
    image.addEventListener('load', () => resolve(image));
    image.src = dataUrl;
  });
  imageCache.set(dataUrl, promise);
  return promise;
}

function previewRenderSizeForTarget(target: IconTarget, mainTab: MainTab) {
  const cssSize = mainTab === 'preview'
    ? target.id.startsWith('android-')
    ? androidPhonePreviewCssSize
    : target.platform === 'ios'
    ? phonePreviewCssSize
    : catalogPreviewCssSize
    : catalogPreviewCssSize;
  const dpr = Math.min(maxPreviewDpr, Math.max(1, window.devicePixelRatio || 1));
  return Math.max(1, Math.min(target.size, Math.ceil(cssSize * dpr)));
}

function previewImageStyle(target: IconTarget, maxCssSize: number) {
  const dpr = Math.min(maxPreviewDpr, Math.max(1, window.devicePixelRatio || 1));
  const cssSize = Math.min(maxCssSize, Math.max(1, target.size / dpr));
  return { height: cssSize, width: cssSize } as CSSProperties;
}

async function resizedSourceDataUrl(dataUrl: string, maxSize: number) {
  const cacheKey = `${maxSize}:${dataUrl}`;
  const cached = resizedSourceCache.get(cacheKey);
  if (cached) return cached;

  const promise = resizeSourceDataUrl(dataUrl, maxSize);
  resizedSourceCache.set(cacheKey, promise);
  return promise;
}

async function previewSourceDataUrl(dataUrl: string, maxSize: number) {
  const cacheKey = `preview:${maxSize}:${dataUrl}`;
  const cached = resizedSourceCache.get(cacheKey);
  if (cached) return cached;

  const promise = trimAndResizeSourceDataUrl(dataUrl, maxSize);
  resizedSourceCache.set(cacheKey, promise);
  return promise;
}

async function resizeSourceDataUrl(dataUrl: string, maxSize: number) {
  const image = await loadImage(dataUrl);
  const sourceMax = Math.max(image.naturalWidth, image.naturalHeight);
  if (sourceMax <= maxSize) return dataUrl;

  const scale = maxSize / sourceMax;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

async function trimAndResizeSourceDataUrl(dataUrl: string, maxSize: number) {
  const image = await loadImage(dataUrl);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) return resizeSourceDataUrl(dataUrl, maxSize);

  sourceContext.drawImage(image, 0, 0);
  const imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bounds = transparentBounds(imageData);
  if (!bounds) return resizeSourceDataUrl(dataUrl, maxSize);

  const sourceWidth = bounds.right - bounds.left + 1;
  const sourceHeight = bounds.bottom - bounds.top + 1;
  const sourceMax = Math.max(sourceWidth, sourceHeight);
  const scale = Math.min(1, maxSize / sourceMax);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return resizeSourceDataUrl(dataUrl, maxSize);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(sourceCanvas, bounds.left, bounds.top, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function readStoredState(): StoredState {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return { options: defaultOptions, source: null, sourceOverrides: {} };
    const parsed = JSON.parse(stored) as Partial<StoredState>;
    return {
      collapsedGroups: parsed.collapsedGroups ?? {},
      options: normalizeStoredOptions(parsed.options),
      source: parsed.source ?? null,
      sourceOverrides: parsed.sourceOverrides ?? {}
    };
  } catch {
    return { options: defaultOptions, source: null, sourceOverrides: {} };
  }
}

function normalizeStoredOptions(options: Partial<IconGenerationOptions> | undefined): IconGenerationOptions {
  return {
    ...defaultOptions,
    ...options,
    backgroundEnd: options?.backgroundEnd ?? options?.background ?? defaultOptions.backgroundEnd,
    backgroundMode: options?.backgroundMode ?? defaultOptions.backgroundMode,
    backgroundScopeMode: options?.backgroundScopeMode ?? 'single',
    borderAngle: options?.borderAngle ?? options?.backgroundAngle ?? defaultOptions.borderAngle,
    borderColor: options?.borderColor ?? defaultOptions.borderColor,
    borderEnd: options?.borderEnd ?? defaultOptions.borderEnd,
    borderMode: options?.borderMode ?? defaultOptions.borderMode,
    borderScopeMode: options?.borderScopeMode ?? 'single',
    borderSize: options?.borderSize ?? defaultOptions.borderSize,
    borderStyle: 'solid',
    platformStyles: options?.platformStyles ?? {},
    shape: options?.shape ?? defaultOptions.shape,
    shapeScopeMode: options?.shapeScopeMode ?? 'single',
    sourceScopeMode: options?.sourceScopeMode ?? 'single',
    targetStyles: options?.targetStyles ?? {}
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('error', () => reject(reader.error));
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.readAsDataURL(file);
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function gzipJson(value: unknown) {
  const stream = new Blob([JSON.stringify(value)], { type: 'application/json' })
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

async function createTarGzipBlob(files: { data: string; path: string; }[]) {
  const tar = createTarArchive(files);
  const stream = new Blob([tar], { type: 'application/x-tar' })
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

function createTarArchive(files: { data: string; path: string; }[]) {
  const chunks: Uint8Array[] = [];

  for (const file of files) {
    const data = base64ToBytes(file.data);
    chunks.push(createTarHeader(file.path, data.byteLength));
    chunks.push(data);
    const padding = tarPadding(data.byteLength);
    if (padding > 0) chunks.push(new Uint8Array(padding));
  }

  chunks.push(new Uint8Array(1024));
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const archive = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

function createTarHeader(filePath: string, size: number) {
  const normalizedPath = filePath.replace(/^\/+/u, '');
  const header = new Uint8Array(512);
  writeTarString(header, 0, 100, normalizedPath);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeTarString(header, 257, 6, 'ustar');
  writeTarString(header, 263, 2, '00');

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarOctal(header, 148, 8, checksum);
  return header;
}

function writeTarString(header: Uint8Array, offset: number, length: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  header.set(bytes.slice(0, length), offset);
}

function writeTarOctal(header: Uint8Array, offset: number, length: number, value: number) {
  const text = value.toString(8).padStart(length - 1, '0').slice(-(length - 1));
  writeTarString(header, offset, length - 1, text);
  header[offset + length - 1] = 0;
}

function tarPadding(size: number) {
  return (512 - (size % 512)) % 512;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function readGzipJson<T>(file: File) {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as T;
}

async function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = fileName;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function mimeFromDataUrl(dataUrl: string) {
  return /^data:([^;]+)/u.exec(dataUrl)?.[1] ?? 'application/octet-stream';
}

function DownloadIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.2' viewBox='0 0 24 24'>
      <path d='M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5' />
      <path d='M16.5 12 12 16.5 7.5 12M12 16.5V3' />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.1' viewBox='0 0 24 24'>
      <path d='M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5' />
      <path d='M7.5 7.5 12 3l4.5 4.5M12 3v13.5' />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.2' viewBox='0 0 24 24'>
      <path d='M12 4.5v15M19.5 12h-15' />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.2' viewBox='0 0 24 24'>
      <path d='m19.5 8.25-7.5 7.5-7.5-7.5' />
    </svg>
  );
}

function XMarkIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.2' viewBox='0 0 24 24'>
      <path d='M6 6l12 12M18 6 6 18' />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.6' viewBox='0 0 24 24'>
      <path d='m5 12.5 4.2 4.2L19 6.8' />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.8' viewBox='0 0 24 24'>
      <path d='M6 12h12' />
    </svg>
  );
}

function DoubleChevronDownIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' viewBox='0 0 24 24'>
      <path d='m7 6 5 5 5-5M7 13l5 5 5-5' />
    </svg>
  );
}

function DoubleChevronUpIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' viewBox='0 0 24 24'>
      <path d='m17 11-5-5-5 5M17 18l-5-5-5 5' />
    </svg>
  );
}

function SingleModeIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.2' viewBox='0 0 24 24'>
      <rect height='16' rx='3' width='16' x='4' y='4' />
    </svg>
  );
}

function MultiModeIcon() {
  return (
    <svg aria-hidden='true' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.2' viewBox='0 0 24 24'>
      <rect height='13' rx='2.5' width='13' x='8' y='8' />
      <path d='M4 16c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2' />
    </svg>
  );
}

function GridTabIcon() {
  return (
    <svg aria-hidden='true' className='tab-icon tab-icon-stroke' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.05' viewBox='0 0 24 24'>
      <rect height='5.9' rx='1.55' width='5.9' x='4.1' y='4.1' />
      <rect height='5.9' rx='1.55' width='5.9' x='14' y='4.1' />
      <rect height='5.9' rx='1.55' width='5.9' x='4.1' y='14' />
      <rect height='5.9' rx='1.55' width='5.9' x='14' y='14' />
    </svg>
  );
}

function AppleTabIcon() {
  return (
    <svg aria-hidden='true' className='tab-icon tab-icon-fill' fill='currentColor' viewBox='0 0 24 24'>
      <path d='M16.6 1.7c0 1.1-.45 2.1-1.18 2.88-.79.84-2.07 1.5-3.14 1.42-.14-1.07.4-2.18 1.13-2.96C14.2 2.18 15.47 1.58 16.6 1.7ZM20.42 17.08c-.43.98-.63 1.41-1.18 2.25-.76 1.17-1.84 2.63-3.18 2.65-1.18.02-1.49-.77-3.1-.76-1.6.01-1.94.79-3.13.77-1.34-.02-2.36-1.33-3.12-2.5-2.13-3.26-2.35-7.08-1.04-9.12.93-1.45 2.4-2.29 3.78-2.29 1.41 0 2.29.77 3.46.77 1.13 0 1.82-.78 3.45-.78 1.24 0 2.55.68 3.48 1.84-3.06 1.67-2.56 6 .58 7.17Z' />
    </svg>
  );
}

function AndroidTabIcon() {
  return (
    <svg aria-hidden='true' className='tab-icon tab-icon-fill' fill='currentColor' viewBox='0 0 24 24'>
      <path d='M7.48 6.12 5.86 3.32a.62.62 0 0 1 1.07-.62L8.6 5.58A8.35 8.35 0 0 1 12 4.9c1.22 0 2.37.24 3.4.68l1.67-2.88a.62.62 0 0 1 1.07.62l-1.62 2.8A7.3 7.3 0 0 1 20.2 12H3.8a7.3 7.3 0 0 1 3.68-5.88ZM8.2 9.7a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6Zm7.6 0a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6ZM4 13.2h16v5.15A2.65 2.65 0 0 1 17.35 21H6.65A2.65 2.65 0 0 1 4 18.35V13.2Z' />
    </svg>
  );
}

function PreviewPhoneTabIcon() {
  return (
    <svg aria-hidden='true' className='tab-icon tab-icon-stroke tab-icon-preview' fill='none' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2.05' viewBox='0 0 24 24'>
      <rect height='18.5' rx='3.2' width='12.5' x='5.75' y='2.75' />
      <path d='M10 6.25h4' />
      <rect height='5.8' rx='1.45' width='5.8' x='9.1' y='8.2' />
      <path d='M10.5 17.75h3' />
    </svg>
  );
}

createRoot(document.querySelector('#root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
