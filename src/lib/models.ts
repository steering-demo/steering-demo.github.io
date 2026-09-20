/**
 * Models the live Space is willing to load.
 *
 * Kept in step with DEFAULT_MODELS in `space/app.py` by hand rather than fetched, so opening the
 * page still costs no network request. The Space falls back to its default for anything it does
 * not recognise, so a mismatch degrades rather than breaks.
 */
export interface LiveModel {
  id: string;
  label: string;
  /** One word on why you might pick it. */
  note: string;
}

export const LIVE_MODELS: LiveModel[] = [
  { id: 'Qwen/Qwen2.5-0.5B-Instruct', label: 'Qwen2.5 0.5B', note: 'sharpest' },
  { id: 'HuggingFaceTB/SmolLM2-135M-Instruct', label: 'SmolLM2 135M', note: 'fastest' },
];

export const DEFAULT_LIVE_MODEL = LIVE_MODELS[0].id;

export function modelLabel(id: string): string {
  return LIVE_MODELS.find((model) => model.id === id)?.label ?? id.split('/').pop() ?? id;
}
