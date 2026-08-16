/**
 * Deterministic extraction strategies. Scheduled runs never call an LLM, so
 * every strategy here is a pure DOM/JSON read. `text` ships with the
 * interpreter; the price cascade strategies are filled in by the extract
 * modules (see `extract-strategies.ts`).
 */
export type ExtractStrategy = 'text' | 'price' | 'json_ld' | 'shopify_json';

export type ExtractFieldSpec = {
  key: string;
  selector?: string;
  strategy?: ExtractStrategy;
};

export type WorkflowStep =
  | { id: string; type: 'goto'; url: string }
  | {
      id: string;
      type: 'fill';
      selector: string;
      source: 'secret' | 'literal';
      secretKey?: string;
      value?: string;
    }
  | { id: string; type: 'click'; selector: string }
  | { id: string; type: 'wait'; selector?: string; timeoutMs?: number }
  | {
      id: string;
      type: 'solve_captcha';
      imageSelector: string;
      inputSelector: string;
    }
  | {
      id: string;
      type: 'extract';
      fields: ExtractFieldSpec[];
    }
  | { id: string; type: 'assert'; selector: string; exists: true };

export type WorkflowStepType = WorkflowStep['type'];
