import React from 'react';
import { t, Trans } from '@grafana/i18n';
import { of } from 'rxjs';
import { SelectableValue } from '@grafana/data';
import { config } from '@grafana/runtime';
import {
  MultiValueVariable,
  MultiValueVariableState,
  SceneComponentProps,
  SceneObjectUrlSyncConfig,
  SceneObjectUrlValues,
  SceneVariableValueChangedEvent,
} from '@grafana/scenes';
import { Alert, Button, Field, LinkButton, RadioButtonGroup, Select, MultiSelect, Stack } from '@grafana/ui';
import {
  compileSpanShapeSelection,
  fetchSpanShapes,
  SemconvSpanShape,
  spanShapeUnsupportedReason,
  registryListPath,
} from '@grafana/otel-semconv-client';
import { primarySignalOptions } from './primary-signals';
import { SpanFilterSelection } from './span-filter-state';
import { reportAppInteraction, USER_EVENTS_ACTIONS, USER_EVENTS_PAGES } from 'utils/analytics';

interface SpanFiltersState extends MultiValueVariableState, SpanFilterSelection {
  shapes?: SemconvSpanShape[];
  catalogLoading: boolean;
  catalogError?: string;
  selectionError?: string;
}

const ROOT_SPANS = 'nestedSetParent<0';
const signalOptions = [{ label: 'Any signal', value: 'true' }, ...primarySignalOptions.slice(2)];

export class PrimarySignalVariable extends MultiValueVariable<SpanFiltersState> {
  protected _urlSync = new SceneObjectUrlSyncConfig(this, { keys: ['var-primarySignal', 'spanScope', 'spanTypes'] });
  private catalogRequest?: Promise<void>;

  constructor(state: Partial<SpanFiltersState>) {
    const scope = state.isReadOnly ? 'all' : 'root';
    super({
      name: 'primarySignal',
      type: 'custom',
      value: scope === 'root' ? ROOT_SPANS : 'true',
      text: '',
      options: [],
      scope,
      primarySignal: 'true',
      semconv: [],
      catalogLoading: false,
      ...state,
    });
    this.addActivationHandler(() => {
      if (this.state.semconv.length > 0) {
        void this.loadCatalog();
      }
    });
  }

  getValueOptions() {
    return of([{ label: String(this.state.value), value: String(this.state.value) }]);
  }

  getSelection(): SpanFilterSelection {
    const { scope, primarySignal, semconv } = this.state;
    return { scope, primarySignal, semconv: [...semconv] };
  }

  getUrlState() {
    return {
      'var-primarySignal': this.state.primarySignal,
      spanScope: this.state.scope,
      spanTypes: this.state.semconv.length ? this.state.semconv : undefined,
    };
  }

  updateFromUrl(values: SceneObjectUrlValues) {
    const legacy = values['var-primarySignal'];
    const signal =
      typeof legacy === 'string' && signalOptions.some((option) => option.value === legacy) ? legacy : 'true';
    const defaultScope = this.state.isReadOnly ? 'all' : 'root';
    const scope =
      values.spanScope === 'root' || values.spanScope === 'all'
        ? values.spanScope
        : legacy === ROOT_SPANS
          ? 'root'
          : legacy == null
            ? defaultScope
            : 'all';
    const raw = values.spanTypes;
    const semconv = Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === 'string')
      : typeof raw === 'string' && raw
        ? [raw]
        : [];
    this.restoreSelection({ scope, primarySignal: signal, semconv });
  }

  restoreSelection(selection: SpanFilterSelection) {
    this.updateSelection(selection);
    if (selection.semconv.length > 0 && !this.state.shapes) {
      void this.loadCatalog();
    }
  }

  public changeValueTo(value: string, _text?: string, isUserAction?: boolean) {
    const update = () =>
      this.restoreSelection({
        scope: value === ROOT_SPANS ? 'root' : 'all',
        primarySignal: value === ROOT_SPANS ? 'true' : value,
        semconv: [],
      });
    if (isUserAction) {
      this._urlSync.performBrowserHistoryAction(update);
    } else {
      update();
    }
  }

  public selectScope = (scope: string) => {
    if (scope !== 'root' && scope !== 'all') {
      return;
    }
    this._urlSync.performBrowserHistoryAction(() => this.updateSelection({ scope }));
  };

  public selectSignal = (primarySignal: string) => {
    this._urlSync.performBrowserHistoryAction(() =>
      this.updateSelection({ primarySignal, ...(primarySignal !== 'true' ? { scope: 'all' } : {}) })
    );
    reportAppInteraction(USER_EVENTS_PAGES.analyse_traces, USER_EVENTS_ACTIONS.analyse_traces.primary_signal_changed, {
      primary_signal: primarySignal,
    });
  };

  public selectSemconv = (semconv: string[]) => {
    this._urlSync.performBrowserHistoryAction(() =>
      this.updateSelection({ semconv, ...(semconv.length > 0 ? { scope: 'all' } : {}) })
    );
    if (semconv.length > 0 && !this.state.shapes) {
      void this.loadCatalog();
    }
  };

  private updateSelection(update: Partial<SpanFiltersState>) {
    const next = { ...this.state, ...update };
    let semantic = 'true';
    let selectionError: string | undefined;
    if (next.semconv.length > 0) {
      if (!next.shapes) {
        semantic = 'false';
      } else {
        try {
          semantic = compileSpanShapeSelection(next.shapes, next.semconv);
        } catch (error) {
          semantic = 'false';
          selectionError = error instanceof Error ? error.message : 'The selected span shape is unavailable.';
        }
      }
    }
    const predicates = [next.scope === 'root' ? ROOT_SPANS : 'true', next.primarySignal, semantic].filter(
      (predicate) => predicate !== 'true'
    );
    const value =
      predicates.length === 0
        ? 'true'
        : predicates.length === 1
          ? predicates[0]
          : predicates.map((predicate) => `(${predicate})`).join(' && ');
    const previous = this.state.value;
    this.setState({ ...update, selectionError, value, text: value });
    if (previous !== value) {
      this.publishEvent(new SceneVariableValueChangedEvent(this), true);
    }
  }

  public loadCatalog = (): Promise<void> => {
    if (this.catalogRequest) {
      return this.catalogRequest;
    }
    if (this.state.shapes && !this.state.catalogError) {
      return Promise.resolve();
    }
    this.setState({ catalogLoading: true, catalogError: undefined });
    this.catalogRequest = fetchSpanShapes()
      .then((shapes) => {
        this.updateSelection({ shapes, catalogLoading: false });
      })
      .catch((error: unknown) => {
        this.setState({
          catalogLoading: false,
          catalogError: error instanceof Error ? error.message : 'Unable to load registry span shapes.',
        });
      })
      .finally(() => {
        this.catalogRequest = undefined;
      });
    return this.catalogRequest;
  };

  static Component = ({ model }: SceneComponentProps<PrimarySignalVariable>) => {
    const { scope, primarySignal, semconv, shapes, catalogLoading, catalogError, selectionError, isReadOnly } =
      model.useState();
    if (isReadOnly) {
      return null;
    }
    const localizedSignalOptions = signalOptions.map((option) => ({
      ...option,
      label: option.value === 'true' ? t('primary-signal-variable.any-signal', 'Any signal') : option.label,
    }));
    const options: Array<SelectableValue<string>> = (shapes ?? [])
      .filter((shape) => !spanShapeUnsupportedReason(shape))
      .map((shape) => ({ label: shape.name, value: `type:${shape.name}` }));
    const selected = semconv.map(
      (value) =>
        options.find((option) => option.value === value) ?? {
          label: value.startsWith('type:') ? value.slice(5) : value,
          value,
        }
    );
    return (
      <Stack direction="column" gap={1}>
        <Stack direction="row" gap={2} alignItems="flex-start" wrap="wrap">
          <Field label={t('primary-signal-variable.span-scope', 'Span scope')} noMargin>
            <RadioButtonGroup
              options={[
                { label: t('primary-signal-variable.root-spans', 'Root spans'), value: 'root' },
                { label: t('primary-signal-variable.all-spans', 'All spans'), value: 'all' },
              ]}
              value={scope}
              onChange={model.selectScope}
            />
          </Field>
          <Field
            label={t('primary-signal-variable.primary-signal-label', 'Primary signal')}
            htmlFor="primary-signal"
            noMargin
          >
            <Select
              inputId="primary-signal"
              options={localizedSignalOptions}
              value={primarySignal}
              onChange={(option) => model.selectSignal(option.value ?? 'true')}
              width={22}
            />
          </Field>
          <Stack direction="column" gap={0}>
            <Field
              label={t('primary-signal-variable.semantic-convention', 'Semantic convention')}
              htmlFor="semconv-span-types"
              noMargin
            >
              <MultiSelect<string>
                inputId="semconv-span-types"
                aria-label={t('primary-signal-variable.semantic-convention', 'Semantic convention')}
                options={options}
                value={selected}
                isClearable
                placeholder={t('primary-signal-variable.any-span-type', 'Any span type')}
                width={40}
                isLoading={catalogLoading}
                onOpenMenu={() => void model.loadCatalog()}
                onChange={(values) =>
                  model.selectSemconv((values ?? []).map((option) => option.value!).filter(Boolean))
                }
              />
            </Field>
            <LinkButton
              href={`${config.appSubUrl ?? ''}${registryListPath('span')}`}
              target="_blank"
              rel="noopener noreferrer"
              icon="external-link-alt"
              size="sm"
              variant="secondary"
              fill="text"
            >
              {t('primary-signal-variable.browse-span-types', 'Browse span types in registry')}
            </LinkButton>
          </Stack>
        </Stack>
        {(catalogError || selectionError) && (
          <Alert
            title={t('primary-signal-variable.filter-unavailable', 'Span-shape filter unavailable')}
            severity="warning"
          >
            {catalogError || selectionError}
            {semconv.length > 0 && (
              <p>
                <Trans i18nKey="primary-signal-variable.unavailable-explanation">
                  The selected filter is retained and matches no spans until it can be resolved. Clear it to remove the
                  restriction.
                </Trans>
              </p>
            )}
            {catalogError && (
              <Button size="sm" variant="secondary" onClick={() => void model.loadCatalog()}>
                {t('primary-signal-variable.retry', 'Retry registry lookup')}
              </Button>
            )}
          </Alert>
        )}
      </Stack>
    );
  };
}
