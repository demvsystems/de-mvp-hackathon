'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TemplateMetadata } from '@/lib/fixture/metadata';
import { FIXTURE_SOURCES, type FixtureSource } from '@/lib/fixture/sources';
import type { GeneratePreviewResponse, SaveFixtureResponse } from '@/lib/fixture/generate-schemas';

interface TemplateSuccessResponse {
  status: 'loaded';
  source: FixtureSource;
  templatePath: string;
  metadata: TemplateMetadata;
  preview: unknown;
}

interface TemplateErrorResponse {
  status: 'error';
  code?: string;
  message: string;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type GenerateState = 'idle' | 'loading' | 'done' | 'error';
type SaveState = 'idle' | 'saving' | 'done' | 'error';
type LibraryState = 'idle' | 'loading' | 'loaded' | 'error';
type ManifestState = 'idle' | 'loading' | 'loaded' | 'error';

type ValidationEntry = GeneratePreviewResponse['validation'][number];
type SourceFilterValue = FixtureSource | 'all';

interface SavedFixtureListItem {
  source: FixtureSource;
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  validation?: ValidationEntry;
}

interface SavedFixtureListResponse {
  fixtures: SavedFixtureListItem[];
}

interface SavedFixtureReadResponse {
  source: FixtureSource;
  filename: string;
  path: string;
  content: Record<string, unknown> | null;
  validation: ValidationEntry;
}

interface ManifestFixtureEntry {
  source: FixtureSource;
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  validationStatus: 'ok' | 'warning' | 'error' | null;
  issueCounts: { warning: number; error: number } | null;
}

interface ManifestSourceSummary {
  count: number;
  valid: number;
  warning: number;
  error: number;
}

interface FixtureManifestPayload {
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  sources: Record<FixtureSource, ManifestSourceSummary>;
  summary: {
    count: number;
    valid: number;
    warning: number;
    error: number;
    sizeBytes: number;
  };
  fixtures: ManifestFixtureEntry[];
}

interface FixtureManifestResponse {
  manifest: FixtureManifestPayload;
  written?: {
    filename: string;
    path: string;
  };
}

export function TemplateInspector() {
  const [source, setSource] = useState<FixtureSource>('jira');
  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<TemplateSuccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generateState, setGenerateState] = useState<GenerateState>('idle');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratePreviewResponse | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveFixtureResponse | null>(null);
  const [libraryState, setLibraryState] = useState<LibraryState>('idle');
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<SavedFixtureListItem[]>([]);
  const [librarySourceFilter, setLibrarySourceFilter] = useState<SourceFilterValue>(source);
  const [selectedSavedFixture, setSelectedSavedFixture] = useState<SavedFixtureReadResponse | null>(
    null,
  );
  const [savedFixtureError, setSavedFixtureError] = useState<string | null>(null);
  const [savedFixtureLoading, setSavedFixtureLoading] = useState(false);
  const [deletingFixture, setDeletingFixture] = useState<string | null>(null);
  const [manifestState, setManifestState] = useState<ManifestState>('idle');
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestData, setManifestData] = useState<FixtureManifestPayload | null>(null);
  const [manifestWrittenPath, setManifestWrittenPath] = useState<string | null>(null);
  const [manifestIncludeValidation, setManifestIncludeValidation] = useState(true);

  const [topic, setTopic] = useState('');
  const [product, setProduct] = useState('');
  const [category, setCategory] = useState('bug');
  const [language, setLanguage] = useState('de');
  const [count, setCount] = useState(3);
  const [detailLevel, setDetailLevel] = useState('medium');
  const [severity, setSeverity] = useState('medium');
  const [sentiment, setSentiment] = useState('neutral');

  useEffect(() => {
    let cancelled = false;
    async function loadTemplate() {
      setState('loading');
      setError(null);
      setData(null);
      setGenerateState('idle');
      setGenerateError(null);
      setPreview(null);
      setSaveState('idle');
      setSaveError(null);
      setSaveResult(null);

      try {
        const response = await fetch(`/api/fixture/template?source=${source}`);
        const body = (await response.json()) as TemplateSuccessResponse | TemplateErrorResponse;

        if (!response.ok || body.status === 'error') {
          const message = body.status === 'error' ? body.message : 'Template load failed.';
          throw new Error(message);
        }

        if (!cancelled) {
          setData(body);
          setState('loaded');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setState('error');
        }
      }
    }

    void loadTemplate();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const loadSavedFixtures = useCallback(async (filter: SourceFilterValue): Promise<void> => {
    setLibraryState('loading');
    setLibraryError(null);
    try {
      const search = new URLSearchParams({
        includeContent: 'false',
        includeValidation: 'true',
      });
      if (filter !== 'all') {
        search.set('source', filter);
      }
      const response = await fetch(`/api/fixture/list?${search.toString()}`);
      const body = (await response.json()) as
        | SavedFixtureListResponse
        | { status: 'error'; message: string };

      if (!response.ok || ('status' in body && body.status === 'error')) {
        const message =
          'message' in body && typeof body.message === 'string'
            ? body.message
            : 'Failed to load saved fixtures.';
        throw new Error(message);
      }

      setLibraryItems((body as SavedFixtureListResponse).fixtures);
      setLibraryState('loaded');
    } catch (libraryErr) {
      setLibraryState('error');
      setLibraryError(libraryErr instanceof Error ? libraryErr.message : String(libraryErr));
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadSavedFixtures(librarySourceFilter);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [librarySourceFilter, loadSavedFixtures]);

  const previewText = useMemo(() => (data ? JSON.stringify(data.preview, null, 2) : ''), [data]);
  const manifestText = useMemo(
    () => (manifestData ? JSON.stringify(manifestData, null, 2) : ''),
    [manifestData],
  );

  const isCountValid = Number.isInteger(count) && count >= 1 && count <= 100;
  const canGenerate =
    state === 'loaded' && topic.trim().length > 0 && product.trim().length > 0 && isCountValid;

  async function onGeneratePreview(): Promise<void> {
    if (!canGenerate) return;

    setGenerateState('loading');
    setGenerateError(null);
    setPreview(null);
    setSaveState('idle');
    setSaveError(null);
    setSaveResult(null);
    try {
      const response = await fetch('/api/fixture/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source,
          topic,
          product,
          category,
          language,
          count,
          detailLevel,
          severity,
          sentiment,
        }),
      });
      const body = (await response.json()) as
        | GeneratePreviewResponse
        | { status: 'error'; message: string };
      if (!response.ok || ('status' in body && body.status === 'error')) {
        const message =
          'message' in body && typeof body.message === 'string'
            ? body.message
            : 'Generate preview failed.';
        throw new Error(message);
      }
      setPreview(body as GeneratePreviewResponse);
      setGenerateState('done');
    } catch (generateErr) {
      setGenerateState('error');
      setGenerateError(generateErr instanceof Error ? generateErr.message : String(generateErr));
    }
  }

  async function onSave(): Promise<void> {
    if (!preview || preview.items.length === 0 || saveState === 'saving') return;

    setSaveState('saving');
    setSaveError(null);
    setSaveResult(null);
    try {
      const response = await fetch('/api/fixture/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source,
          items: preview.items,
          overwrite: false,
        }),
      });
      const body = (await response.json()) as
        | SaveFixtureResponse
        | { status: 'error'; message: string };

      if (!response.ok || ('status' in body && body.status === 'error')) {
        const message =
          'message' in body && typeof body.message === 'string' ? body.message : 'Save failed.';
        throw new Error(message);
      }

      setSaveResult(body as SaveFixtureResponse);
      setSaveState('done');
      await loadSavedFixtures(librarySourceFilter);
    } catch (saveErr) {
      setSaveState('error');
      setSaveError(saveErr instanceof Error ? saveErr.message : String(saveErr));
    }
  }

  async function onOpenSavedFixture(entry: SavedFixtureListItem): Promise<void> {
    setSavedFixtureLoading(true);
    setSavedFixtureError(null);
    try {
      const search = new URLSearchParams({
        source: entry.source,
        filename: entry.filename,
      });
      const response = await fetch(`/api/fixture/read?${search.toString()}`);
      const body = (await response.json()) as
        | SavedFixtureReadResponse
        | { status: 'error'; message: string };
      if (!response.ok || ('status' in body && body.status === 'error')) {
        const message =
          'message' in body && typeof body.message === 'string'
            ? body.message
            : 'Failed to read saved fixture.';
        throw new Error(message);
      }
      setSelectedSavedFixture(body as SavedFixtureReadResponse);
    } catch (readErr) {
      setSavedFixtureError(readErr instanceof Error ? readErr.message : String(readErr));
    } finally {
      setSavedFixtureLoading(false);
    }
  }

  async function onDeleteSavedFixture(entry: SavedFixtureListItem): Promise<void> {
    if (!window.confirm(`Delete saved fixture ${entry.filename}?`)) return;
    setDeletingFixture(`${entry.source}:${entry.filename}`);
    setSavedFixtureError(null);
    try {
      const response = await fetch('/api/fixture/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: entry.source,
          filename: entry.filename,
        }),
      });
      const body = (await response.json()) as { status?: 'error'; message?: string };
      if (!response.ok || body.status === 'error') {
        const message = typeof body.message === 'string' ? body.message : 'Delete failed.';
        throw new Error(message);
      }

      if (
        selectedSavedFixture &&
        selectedSavedFixture.filename === entry.filename &&
        selectedSavedFixture.source === entry.source
      ) {
        setSelectedSavedFixture(null);
      }
      await loadSavedFixtures(librarySourceFilter);
    } catch (deleteErr) {
      setSavedFixtureError(deleteErr instanceof Error ? deleteErr.message : String(deleteErr));
    } finally {
      setDeletingFixture(null);
    }
  }

  async function onBuildManifest(write: boolean): Promise<void> {
    setManifestState('loading');
    setManifestError(null);
    if (!write) {
      setManifestWrittenPath(null);
    }

    try {
      const search = new URLSearchParams({
        includeValidation: manifestIncludeValidation ? 'true' : 'false',
        write: write ? 'true' : 'false',
      });
      if (librarySourceFilter !== 'all') {
        search.set('source', librarySourceFilter);
      }

      const response = await fetch(`/api/fixture/manifest?${search.toString()}`);
      const body = (await response.json()) as
        | FixtureManifestPayload
        | FixtureManifestResponse
        | { status: 'error'; message: string };

      if (!response.ok || ('status' in body && body.status === 'error')) {
        const message =
          'message' in body && typeof body.message === 'string'
            ? body.message
            : 'Failed to build fixture manifest.';
        throw new Error(message);
      }

      if ('manifest' in body) {
        setManifestData(body.manifest);
        setManifestWrittenPath(body.written?.path ?? null);
      } else {
        setManifestData(body as FixtureManifestPayload);
      }
      setManifestState('loaded');
    } catch (manifestErr) {
      setManifestState('error');
      setManifestError(manifestErr instanceof Error ? manifestErr.message : String(manifestErr));
    }
  }

  async function onCopyManifest(): Promise<void> {
    if (!manifestText) return;
    try {
      await navigator.clipboard.writeText(manifestText);
    } catch {
      setManifestError('Failed to copy manifest JSON to clipboard.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Source Template</CardTitle>
          <CardDescription>Select a source to auto-load its template.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Source</label>
              <Select
                value={source}
                onValueChange={(value) => {
                  const nextSource = value as FixtureSource;
                  setSource(nextSource);
                  if (librarySourceFilter !== 'all') {
                    setLibrarySourceFilter(nextSource);
                  }
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {FIXTURE_SOURCES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="outline">{state}</Badge>
          </div>

          {state === 'loading' ? (
            <Alert>
              <AlertTitle>Loading</AlertTitle>
              <AlertDescription>
                Loading template for source <code className="font-mono">{source}</code>...
              </AlertDescription>
            </Alert>
          ) : null}

          {state === 'error' && error ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {state === 'loaded' && data ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertTitle>Template loaded</AlertTitle>
                <AlertDescription>
                  Template path: <code className="font-mono text-xs">{data.templatePath}</code>
                </AlertDescription>
              </Alert>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Top-level fields</h3>
                <div className="flex flex-wrap gap-2">
                  {data.metadata.topLevelFields.map((field) => (
                    <Badge key={field} variant="secondary">
                      {field}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <MetaItem
                  label="detectedObjectType"
                  value={data.metadata.detectedObjectType ?? 'n/a'}
                />
                <MetaItem label="hasUser" value={String(data.metadata.hasUser)} />
                <MetaItem label="hasMessageBody" value={String(data.metadata.hasMessageBody)} />
                <MetaItem label="hasTimestamp" value={String(data.metadata.hasTimestamp)} />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Truncated preview</h3>
                <pre className="bg-muted max-h-96 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                  <code>{previewText}</code>
                </pre>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Topic" required>
              <Input value={topic} onChange={(event) => setTopic(event.target.value)} />
            </FormField>
            <FormField label="Product / Internal Tool" required>
              <Input value={product} onChange={(event) => setProduct(event.target.value)} />
            </FormField>
            <FormField label="Category" required>
              <Input value={category} onChange={(event) => setCategory(event.target.value)} />
            </FormField>
            <FormField label="Language" required>
              <Input value={language} onChange={(event) => setLanguage(event.target.value)} />
            </FormField>
            <FormField label="Count" required>
              <Input
                type="number"
                min={1}
                max={100}
                value={String(count)}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </FormField>
            <FormField label="Detail Level">
              <Select
                value={detailLevel}
                onValueChange={(value) => setDetailLevel(value ?? 'medium')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Severity">
              <Select value={severity} onValueChange={(value) => setSeverity(value ?? 'medium')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="critical">critical</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Sentiment">
              <Select value={sentiment} onValueChange={(value) => setSentiment(value ?? 'neutral')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="neutral">neutral</SelectItem>
                  <SelectItem value="frustrated">frustrated</SelectItem>
                  <SelectItem value="positive">positive</SelectItem>
                  <SelectItem value="negative">negative</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {!isCountValid ? (
            <Alert variant="destructive">
              <AlertTitle>Invalid count</AlertTitle>
              <AlertDescription>Count must be an integer between 1 and 100.</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              disabled={!canGenerate || generateState === 'loading'}
              onClick={onGeneratePreview}
            >
              {generateState === 'loading' ? 'Generating...' : 'Generate Preview'}
            </Button>
            <Button
              variant="outline"
              disabled={!preview || preview.items.length === 0 || saveState === 'saving'}
              onClick={onSave}
            >
              {saveState === 'saving' ? 'Saving...' : 'Save'}
            </Button>
          </div>

          {generateState === 'error' && generateError ? (
            <Alert variant="destructive">
              <AlertTitle>Generate error</AlertTitle>
              <AlertDescription>{generateError}</AlertDescription>
            </Alert>
          ) : null}

          {generateState === 'done' && preview ? (
            <div className="flex flex-col gap-3">
              {preview.warnings.length > 0 ? (
                <Alert>
                  <AlertTitle>Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {preview.items.map((item) => (
                <Card key={item.filename}>
                  <CardHeader>
                    <CardTitle className="text-base">{item.filename}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-muted max-h-72 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                      <code>{JSON.stringify(item.content, null, 2)}</code>
                    </pre>

                    {preview.validation ? (
                      <div className="mt-3 flex flex-col gap-2">
                        {(() => {
                          const validation = preview.validation.find(
                            (entry) => entry.filename === item.filename,
                          );
                          if (!validation) return null;
                          return (
                            <div className="rounded-lg border p-2">
                              <p className="text-sm">
                                Validation:{' '}
                                <Badge
                                  variant={
                                    validation.status === 'ok'
                                      ? 'secondary'
                                      : validation.status === 'warning'
                                        ? 'outline'
                                        : 'destructive'
                                  }
                                >
                                  {validation.status}
                                </Badge>
                              </p>
                              {validation.issues.length > 0 ? (
                                <ul className="mt-2 list-disc pl-4 text-xs">
                                  {validation.issues.map((issue, idx) => (
                                    <li key={`${issue.path}-${issue.message}-${idx}`}>
                                      <span className="font-medium">{issue.severity}</span> ·{' '}
                                      <code>{issue.path}</code> · {issue.message}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-muted-foreground mt-1 text-xs">
                                  No issues detected.
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          {saveState === 'error' && saveError ? (
            <Alert variant="destructive">
              <AlertTitle>Save error</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          {saveState === 'done' && saveResult ? (
            <div className="flex flex-col gap-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Saved files</CardTitle>
                </CardHeader>
                <CardContent>
                  {saveResult.saved.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No files saved.</p>
                  ) : (
                    <ul className="list-disc pl-4 text-sm">
                      {saveResult.saved.map((entry) => (
                        <li key={`${entry.filename}-${entry.path}`}>
                          <code className="font-mono">{entry.path}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {saveResult.warnings.length > 0 ? (
                <Alert>
                  <AlertTitle>Save warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {saveResult.warnings.map((warning) => (
                        <li key={`${warning.filename}-${warning.message}`}>
                          {warning.filename}: {warning.message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved fixtures</CardTitle>
              <CardDescription>
                Browse saved generated fixtures for consumer readiness checks.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48">
                  <Select
                    value={librarySourceFilter}
                    onValueChange={(value) => setLibrarySourceFilter(value as SourceFilterValue)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Filter source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all</SelectItem>
                      {FIXTURE_SOURCES.map((entry) => (
                        <SelectItem key={`saved-${entry}`} value={entry}>
                          {entry}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  disabled={libraryState === 'loading'}
                  onClick={() => void loadSavedFixtures(librarySourceFilter)}
                >
                  {libraryState === 'loading' ? 'Refreshing...' : 'Refresh'}
                </Button>
                <Badge variant="outline">{libraryState}</Badge>
              </div>

              {libraryState === 'error' && libraryError ? (
                <Alert variant="destructive">
                  <AlertTitle>Library error</AlertTitle>
                  <AlertDescription>{libraryError}</AlertDescription>
                </Alert>
              ) : null}

              {savedFixtureError ? (
                <Alert variant="destructive">
                  <AlertTitle>Saved fixture error</AlertTitle>
                  <AlertDescription>{savedFixtureError}</AlertDescription>
                </Alert>
              ) : null}

              {libraryItems.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No saved fixtures in current filter.
                </p>
              ) : (
                <div className="grid gap-2">
                  {libraryItems.map((entry) => (
                    <div
                      key={`${entry.source}-${entry.filename}`}
                      className="border-border flex flex-col gap-2 rounded-lg border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{entry.filename}</p>
                          <p className="text-muted-foreground text-xs">
                            {entry.source} · {new Date(entry.modifiedAt).toLocaleString()} ·{' '}
                            {entry.sizeBytes} bytes
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {entry.validation ? (
                            <Badge
                              variant={
                                entry.validation.status === 'ok'
                                  ? 'secondary'
                                  : entry.validation.status === 'warning'
                                    ? 'outline'
                                    : 'destructive'
                              }
                            >
                              {entry.validation.status}
                            </Badge>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={savedFixtureLoading}
                            onClick={() => void onOpenSavedFixture(entry)}
                          >
                            Open
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deletingFixture === `${entry.source}:${entry.filename}`}
                            onClick={() => void onDeleteSavedFixture(entry)}
                          >
                            {deletingFixture === `${entry.source}:${entry.filename}`
                              ? 'Deleting...'
                              : 'Delete'}
                          </Button>
                        </div>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        <code>{entry.path}</code>
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {selectedSavedFixture ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Selected saved fixture</h3>
                  <p className="text-muted-foreground text-xs">
                    <code>{selectedSavedFixture.path}</code>
                  </p>
                  <pre className="bg-muted max-h-72 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                    <code>{JSON.stringify(selectedSavedFixture.content, null, 2)}</code>
                  </pre>
                  <div className="rounded-lg border p-2">
                    <p className="text-sm">
                      Validation:{' '}
                      <Badge
                        variant={
                          selectedSavedFixture.validation.status === 'ok'
                            ? 'secondary'
                            : selectedSavedFixture.validation.status === 'warning'
                              ? 'outline'
                              : 'destructive'
                        }
                      >
                        {selectedSavedFixture.validation.status}
                      </Badge>
                    </p>
                    {selectedSavedFixture.validation.issues.length > 0 ? (
                      <ul className="mt-2 list-disc pl-4 text-xs">
                        {selectedSavedFixture.validation.issues.map((issue, idx) => (
                          <li key={`${issue.path}-${issue.message}-${idx}`}>
                            <span className="font-medium">{issue.severity}</span> ·{' '}
                            <code>{issue.path}</code> · {issue.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-xs">No issues detected.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fixture manifest</CardTitle>
              <CardDescription>
                Build a consumer-ready manifest from saved fixtures.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48">
                  <Select
                    value={manifestIncludeValidation ? 'true' : 'false'}
                    onValueChange={(value) => setManifestIncludeValidation(value === 'true')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Include validation" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">include validation</SelectItem>
                      <SelectItem value="false">no validation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  disabled={manifestState === 'loading'}
                  onClick={() => void onBuildManifest(false)}
                >
                  {manifestState === 'loading' ? 'Building...' : 'Build manifest'}
                </Button>
                <Button
                  variant="outline"
                  disabled={manifestState === 'loading'}
                  onClick={() => void onBuildManifest(true)}
                >
                  {manifestState === 'loading' ? 'Writing...' : 'Write manifest.json'}
                </Button>
                <Button
                  variant="outline"
                  disabled={!manifestText}
                  onClick={() => void onCopyManifest()}
                >
                  Copy JSON
                </Button>
                <Badge variant="outline">{manifestState}</Badge>
              </div>

              {manifestError ? (
                <Alert variant="destructive">
                  <AlertTitle>Manifest error</AlertTitle>
                  <AlertDescription>{manifestError}</AlertDescription>
                </Alert>
              ) : null}

              {manifestData ? (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <MetaItem label="generatedAt" value={manifestData.generatedAt} />
                    <MetaItem label="fixtures" value={String(manifestData.summary.count)} />
                    <MetaItem
                      label="validation (ok/warn/error)"
                      value={`${manifestData.summary.valid}/${manifestData.summary.warning}/${manifestData.summary.error}`}
                    />
                    <MetaItem label="sizeBytes" value={String(manifestData.summary.sizeBytes)} />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {FIXTURE_SOURCES.map((entry) => {
                      const stats = manifestData.sources[entry];
                      return (
                        <MetaItem
                          key={`manifest-source-${entry}`}
                          label={`${entry} count`}
                          value={`${stats.count} (${stats.valid}/${stats.warning}/${stats.error})`}
                        />
                      );
                    })}
                  </div>

                  <p className="text-muted-foreground text-xs">
                    Root: <code>{manifestData.root}</code>
                  </p>

                  {manifestWrittenPath ? (
                    <Alert>
                      <AlertTitle>Manifest written</AlertTitle>
                      <AlertDescription>
                        <code>{manifestWrittenPath}</code>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <pre className="bg-muted max-h-96 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                    <code>{manifestText}</code>
                  </pre>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No manifest built yet.</p>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}

function FormField({
  label,
  children,
  required = false,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
