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
      fields: Array<{
        key: string;
        selector?: string;
        strategy?: 'text' | 'price' | 'json_ld' | 'shopify_json';
      }>;
    }
  | { id: string; type: 'assert'; selector: string; exists: true };
